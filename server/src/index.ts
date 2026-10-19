// server/src/index.ts
import dotenv from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import bcrypt from 'bcryptjs';

import healthHandler from './routes/health.js';
import submitHandler from './routes/submit.js';
import { pool } from './db/pg.js';
import { getMongoDb, closeMongo } from './db/mongo.js';
import { ensureOutboxSchema, startTaskEventWorker } from './db/outbox.js';
import listPlansHandler from './routes/plans.js';
import getPlanHandler from './routes/getPlan.js';
import updatePlanHandler from './routes/updatePlan.js';
import deletePlanHandler from './routes/deletePlan.js';
import activityHandler from './routes/activity.js';
import statsHandler from './routes/stats.js';
import pertHandler from './routes/pert.js';
import activityExportHandler from './routes/activityExport.js';

import {
  loginHandler,
  meHandler,
  updateProfileHandler,
  signupHandler,
} from './routes/auth.js';
import { requireAuth } from './middlewares/auth.js';

dotenv.config();

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a chain of plans for a user, with automatic depends_on
 * plan2 → depends_on plan1, plan3 → depends_on plan2, etc.
 */
type SeedTask = {
  title: string;
  minutes: number;
  offsetDays: number;
  note: string;
  /**
   * Index (0-based) of the task this one depends on.
   *  - null / undefined  => no dependency
   *  - 0                 => depends on first task
   *  - 1                 => depends on second task, etc.
   */
  dependsOn?: number | null;
};

async function seedPlansForUser(userId: number, tasks: SeedTask[]) {
  if (!tasks.length) return;

  // If the user already has plans, don't seed again.
  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM plans WHERE user_id = $1',
    [userId],
  );
  if (countRows[0].c > 0) return;

  // 1) Insert all tasks with depends_on = NULL
  const valuesSql = tasks
    .map((_t, i) => {
      const base = i * 4;
      return `(
        $1,
        $${base + 2},                                  -- title
        $${base + 3},                                  -- expected_minutes
        (now() + ($${base + 4} || ' days')::interval)::timestamptz,
        $${base + 5},                                  -- note
        'not_started',
        NULL
      )`;
    })
    .join(',\n');

  const params: any[] = [userId];
  for (const t of tasks) {
    params.push(t.title, t.minutes, t.offsetDays, t.note);
  }

  const insertSql = `
    INSERT INTO plans (user_id, title, expected_minutes, due_at, note, status, depends_on)
    VALUES
    ${valuesSql}
    RETURNING id;
  `;

  const res = await pool.query(insertSql, params);
  const ids = res.rows.map((r) => r.id as number);

  // 2) Update dependencies according to dependsOn index
  for (let i = 0; i < tasks.length; i++) {
    const depIndex = tasks[i].dependsOn;
    if (depIndex === undefined || depIndex === null) continue;

    const childId = ids[i];
    const parentId = ids[depIndex];
    if (!childId || !parentId) continue;

    await pool.query('UPDATE plans SET depends_on = $2 WHERE id = $1', [
      childId,
      parentId,
    ]);
  }
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
app.use(
  '*',
  cors({
    origin: ORIGIN,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

// ---------------------------------------------------------------------------
// Routes publiques
// ---------------------------------------------------------------------------
app.get('/health', healthHandler);

// Auth
app.post('/api/auth/signup', signupHandler);
app.post('/api/auth/login', loginHandler);
app.get('/api/auth/me', requireAuth, meHandler);
app.patch('/api/users/me', requireAuth, updateProfileHandler);

// ---------------------------------------------------------------------------
// Routes protégées API
// ---------------------------------------------------------------------------
app.post('/api/submit', requireAuth, submitHandler);

app.get('/api/plans', requireAuth, listPlansHandler);
app.get('/api/plans/:id', requireAuth, getPlanHandler);
app.patch('/api/plans/:id', requireAuth, updatePlanHandler);
app.delete('/api/plans/:id', requireAuth, deletePlanHandler);

app.get('/api/stats', requireAuth, statsHandler);
app.get('/api/activity', requireAuth, activityHandler);
app.get('/api/activity/export', requireAuth, activityExportHandler);

app.get('/api/pert', requireAuth, pertHandler);

// ---------------------------------------------------------------------------
// Schema + seed (Postgres)
// ---------------------------------------------------------------------------
async function ensureSchema() {
  const sql = `
    -- ===============================================================
    -- Base tables
    -- ===============================================================

    -- Utilisateurs
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    DO $$
    BEGIN
      -- full_name
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'full_name'
      ) THEN
        ALTER TABLE users ADD COLUMN full_name TEXT NULL;
      END IF;

      -- avatar_data : data URL (base64) <= petite image
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'avatar_data'
      ) THEN
        ALTER TABLE users ADD COLUMN avatar_data TEXT NULL;
      END IF;
    END $$;

    -- Table principale plans (structure cible)
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      expected_minutes INT CHECK (expected_minutes > 0),
      actual_minutes INT NULL CHECK (actual_minutes >= 0),
      due_at TIMESTAMPTZ NOT NULL,
      note TEXT NULL,
      depends_on INT NULL REFERENCES plans(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ===============================================================
    -- Migrations douces sur plans
    -- ===============================================================

    -- Si la colonne depends_on est encore en INT[] → on la convertit en INT
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'plans'
          AND column_name = 'depends_on'
          AND udt_name = '_int4'  -- int4[]
      ) THEN
        ALTER TABLE plans
          ALTER COLUMN depends_on DROP NOT NULL,
          ALTER COLUMN depends_on DROP DEFAULT,
          ALTER COLUMN depends_on TYPE integer
          USING CASE
            WHEN depends_on IS NULL OR cardinality(depends_on) = 0 THEN NULL
            ELSE depends_on[1]
          END;
      END IF;
    EXCEPTION
      WHEN others THEN
        NULL;
    END $$;

    -- Ajouter user_id si manquant
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'plans'
          AND column_name = 'user_id'
      ) THEN
        ALTER TABLE plans
          ADD COLUMN user_id INT NULL REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    EXCEPTION
      WHEN others THEN
        NULL;
    END $$;

    -- ===============================================================
    -- Projets, tags, sous-tâches, time tracking
    -- ===============================================================

    -- Projets
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Colonne project_id sur plans
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'plans'
          AND column_name = 'project_id'
      ) THEN
        ALTER TABLE plans
          ADD COLUMN project_id INT NULL;
      END IF;
    EXCEPTION
      WHEN others THEN
        NULL;
    END $$;

    -- Priorité
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'plans'
          AND column_name = 'priority'
      ) THEN
        ALTER TABLE plans
          ADD COLUMN priority INT NOT NULL DEFAULT 0;
      END IF;
    EXCEPTION
      WHEN others THEN
        NULL;
    END $$;

    -- Récurrence (RRULE ou autre)
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'plans'
          AND column_name = 'recurrence_rule'
      ) THEN
        ALTER TABLE plans
          ADD COLUMN recurrence_rule TEXT NULL;
      END IF;
    EXCEPTION
      WHEN others THEN
        NULL;
    END $$;

    -- Labels
    CREATE TABLE IF NOT EXISTS labels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Pivot plan_labels
    CREATE TABLE IF NOT EXISTS plan_labels (
      plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (plan_id, label_id)
    );

    -- Sous-tâches
    CREATE TABLE IF NOT EXISTS subtasks (
      id SERIAL PRIMARY KEY,
      plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Time entries (time-tracker futur)
    CREATE TABLE IF NOT EXISTS time_entries (
      id SERIAL PRIMARY KEY,
      plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      minutes INT NOT NULL CHECK (minutes > 0),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ===============================================================
    -- Index utiles
    -- ===============================================================
    CREATE INDEX IF NOT EXISTS idx_plans_due_at ON plans (due_at);
    CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans (created_at);
    CREATE INDEX IF NOT EXISTS idx_plans_user_due_at ON plans (user_id, due_at);
    CREATE INDEX IF NOT EXISTS idx_plans_project ON plans (project_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_plan ON subtasks (plan_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_plan ON time_entries (plan_id);
  `;

  await pool.query(sql);
  await ensureOutboxSchema();

  // Demo creation and destructive reset are opt-in, never ordinary startup work.
  if (process.env.SEED_DEMO_DATA !== 'true') return;

  // ----------------------------------------------------------
  // Reset optionnel (Railway / dev)
  // ----------------------------------------------------------
  const shouldReset =
    process.env.RESET_DB_ON_BOOT === '1' ||
    process.env.RESET_DB_ON_BOOT === 'true';

  if (shouldReset) {
    console.log('[Boot] RESET_DB_ON_BOOT enabled → truncating tables…');

    await pool.query('TRUNCATE TABLE time_entries RESTART IDENTITY CASCADE;');
    await pool.query('TRUNCATE TABLE subtasks RESTART IDENTITY CASCADE;');
    await pool.query('TRUNCATE TABLE plan_labels RESTART IDENTITY CASCADE;');
    await pool.query('TRUNCATE TABLE labels RESTART IDENTITY CASCADE;');
    await pool.query('TRUNCATE TABLE projects RESTART IDENTITY CASCADE;');
    await pool.query('TRUNCATE TABLE plans RESTART IDENTITY CASCADE;');

    try {
      const db = await getMongoDb();
      await db.collection('plans').deleteMany({});
      await db.collection('events').deleteMany({});
      console.log('[Boot] Mongo projections cleared');
    } catch (e) {
      console.error('[Boot] Failed to reset Mongo projections', e);
    }
  }

  // ----------------------------------------------------------
  // Seed utilisateur DEMO
  // ----------------------------------------------------------
  const demoEmail = process.env.DEMO_EMAIL || 'demo@planwatch.test';
  const demoPassword = process.env.DEMO_PASSWORD || 'Cookie@123';

  const existingDemo = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [demoEmail],
  );

  let demoUserId: number;

  if (!existingDemo.rows.length) {
    const hash = await bcrypt.hash(demoPassword, 10);
    const inserted = await pool.query(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
      [demoEmail, hash, 'Demo user'],
    );
    demoUserId = inserted.rows[0].id as number;
    console.log('[PG] Seeded demo user', demoEmail);
  } else {
    demoUserId = existingDemo.rows[0].id as number;
  }

  const { rows: demoCountRows } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM plans WHERE user_id = $1',
    [demoUserId],
  );
  if (demoCountRows[0].c === 0) {
    const seedSql = `
      INSERT INTO plans (user_id, title, expected_minutes, actual_minutes, due_at, note, depends_on, status)
      SELECT
        $1       AS user_id,
        title,
        expected_minutes,
        actual_minutes,
        due_at,
        note,
        depends_on,
        status
      FROM (
        VALUES
          ('Define project scope',        60,  45, (now() - interval '3 days')::TIMESTAMPTZ, 'Clarify objectives and constraints.'::TEXT, NULL::INT, 'not_started'::TEXT),
          ('Gather reference material',   90,  80, (now() - interval '1 day')::TIMESTAMPTZ, 'Collect NoSQL papers & docs.'::TEXT,       1::INT,  'not_started'::TEXT),
          ('Design PlanWatch data model', 75, NULL,(now())::TIMESTAMPTZ,                      'Tables for plans, activity, PERT, users.'::TEXT, 1::INT, 'not_started'::TEXT),
          ('Set up PostgreSQL schema',    60, NULL,(now() + interval '1 day')::TIMESTAMPTZ,   'Apply create.sql & indexes.'::TEXT,             2::INT, 'not_started'::TEXT),
          ('Implement stats & activity API',90,NULL,(now() + interval '2 days')::TIMESTAMPTZ, 'Hono routes for stats, activity, pert.'::TEXT, 3::INT, 'not_started'::TEXT),
          ('Build dashboard UI',         120, NULL,(now() + interval '4 days')::TIMESTAMPTZ,  'Cards, tasks board, recent activity.'::TEXT,    5::INT, 'not_started'::TEXT),
          ('Implement PERT graph',       110, NULL,(now() + interval '5 days')::TIMESTAMPTZ,  'Cytoscape layout + critical path.'::TEXT,      5::INT, 'not_started'::TEXT),
          ('Polish dark/light theme',     60, NULL,(now() + interval '7 days')::TIMESTAMPTZ,  'Background, cards, transitions.'::TEXT,        6::INT, 'not_started'::TEXT),
          ('Write NoSQL report draft',   150, NULL,(now() + interval '10 days')::TIMESTAMPTZ, 'Explain choices, architecture, tradeoffs.'::TEXT, 8::INT, 'not_started'::TEXT),
          ('Prepare project demo',        90, NULL,(now() + interval '14 days')::TIMESTAMPTZ, 'Record video + live demo script.'::TEXT,       8::INT, 'not_started'::TEXT)
      ) AS seed(
        title,
        expected_minutes,
        actual_minutes,
        due_at,
        note,
        depends_on,
        status
      );
    `;
    await pool.query(seedSql, [demoUserId]);
    console.log('[PG] Seeded demo plans');
  }

  // ----------------------------------------------------------
  // Seed Yahya + Laurent Morelli
  // ----------------------------------------------------------
  const usersSeed = [
    {
      email: 'yahya@planwatch.test',
      fullName: 'Yahya Farehan',
      password: process.env.SEED_PASSWORD || 'Planwatch@123',
    },
    {
      email: 'laurent.morelli@planwatch.test',
      fullName: 'Laurent Morelli',
      password: process.env.SEED_PASSWORD || 'Planwatch@123',
    },
  ];

  const userIds: Record<string, number> = {};

  for (const u of usersSeed) {
    const email = u.email.toLowerCase();
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
  
    const hash = await bcrypt.hash(u.password, 10);
  
    if (!existing.rows.length) {
      const inserted = await pool.query(
        'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id',
        [email, hash, u.fullName],
      );
      userIds[email] = inserted.rows[0].id as number;
      console.log('[PG] Seeded user', email);
    } else {
      const id = existing.rows[0].id as number;
      userIds[email] = id;
  
      console.log('[PG] Kept existing seed user', email);
    }
  }
  

  const yahyaId = userIds['yahya@planwatch.test'];
  const morelliId = userIds['laurent.morelli@planwatch.test'];

  // Yahya : un petit graphe avec des branches
  await seedPlansForUser(yahyaId, [
    // index 0
    {
      title: 'Deep work – coding session',
      minutes: 90,
      offsetDays: 0,
      note: 'Ship a small feature for PlanWatch.',
      dependsOn: null,          // racine
    },
    // index 1
    {
      title: 'Basketball practice',
      minutes: 120,
      offsetDays: 1,
      note: 'Shooting + conditioning.',
      dependsOn: 0,             // après deep work
    },
    // index 2
    {
      title: 'Painting session',
      minutes: 180,
      offsetDays: 2,
      note: 'Work on a new canvas.',
      dependsOn: 1,             // après basket
    },
    // index 3
    {
      title: 'Gym workout',
      minutes: 75,
      offsetDays: 3,
      note: 'Push / pull routine.',
      dependsOn: 1,             // autre branche après basket
    },
    // index 4
    {
      title: 'Music / chill session',
      minutes: 60,
      offsetDays: 4,
      note: 'Listening & relaxing.',
      dependsOn: 2,             // après peinture
    },
  ]);

  // Laurent Morelli : graphe académique
  await seedPlansForUser(morelliId, [
    // index 0
    {
      title: 'Review PlanWatch project status',
      minutes: 60,
      offsetDays: 0,
      note: 'Check latest progress & risks.',
      dependsOn: null,          // racine
    },
    // index 1
    {
      title: 'Prepare NoSQL / databases lecture',
      minutes: 120,
      offsetDays: 2,
      note: 'Slides + examples.',
      dependsOn: 0,             // après review
    },
    // index 2
    {
      title: 'Correct student projects',
      minutes: 180,
      offsetDays: 4,
      note: 'Grading & feedback.',
      dependsOn: 1,             // après préparation cours
    },
    // index 3
    {
      title: 'Department meeting / planning',
      minutes: 60,
      offsetDays: 6,
      note: 'Align schedule & exams.',
      dependsOn: 0,             // autre branche après review
    },
    // index 4
    {
      title: 'Research time – new tech',
      minutes: 90,
      offsetDays: 8,
      note: 'Experiment with new frameworks.',
      dependsOn: 2,             // après correction projets
    },
    // index 5
    {
      title: 'Long-term course redesign',
      minutes: 180,
      offsetDays: 14,
      note: 'Plan improvements for next year.',
      dependsOn: 4,             // après research (chemin critique)
    },
  ]);
}

// ---------------------------------------------------------------------------
// Mongo: indexes / “schema” minimal
// ---------------------------------------------------------------------------
async function ensureMongoSchema() {
  const db = await getMongoDb();

  await db.collection('events').createIndex(
    { eventId: 1 }, { unique: true, partialFilterExpression: { eventId: { $exists: true } } },
  );

  await db
    .collection('plans')
    .createIndex({ pgId: 1, userId: 1 }, { unique: true })
    .catch(() => {});
  await db
    .collection('plans')
    .createIndex({ userId: 1, dueAt: 1 })
    .catch(() => {});
  await db
    .collection('plans')
    .createIndex({ status: 1 })
    .catch(() => {});

  await db
    .collection('events')
    .createIndex({ userId: 1, at: -1 })
    .catch(() => {});
  await db
    .collection('events')
    .createIndex({ planId: 1 })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
let stopTaskEvents: (() => Promise<void>) | undefined;

async function start() {
  console.log('Boot config', {
    HOST,
    PORT,
    CORS_ORIGIN: ORIGIN,
  });

  try {
    await pool.query('SELECT 1');
    console.log('[PG] Connection OK');
    await ensureSchema();
    console.log('[PG] Schema OK (with seed & migrations)');
  } catch (e) {
    throw new Error('PostgreSQL connection or schema initialization failed.', { cause: e });
  }

  try {
    await ensureMongoSchema();
    console.log('[Mongo] Connection + indexes OK');
  } catch (e) {
    console.error('[Mongo] Connection or indexes FAILED:', e);
  }

  console.log('Starting HTTP server…');
  stopTaskEvents = startTaskEventWorker();
  serve({ fetch: app.fetch, port: PORT, hostname: HOST });
}

start().catch((e) => {
  console.error('Fatal error during startup', e);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown() {
  console.log('Shutting down…');
  await stopTaskEvents?.();
  try {
    await pool.end();
  } catch (e) {
    console.error('Error while closing Postgres pool', e);
  }
  try {
    await closeMongo();
  } catch (e) {
    console.error('Error while closing Mongo connection', e);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
