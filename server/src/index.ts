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
import listPlansHandler from './routes/plans.js';
import getPlanHandler from './routes/getPlan.js';
import updatePlanHandler from './routes/updatePlan.js';
import deletePlanHandler from './routes/deletePlan.js';
import activityHandler from './routes/activity.js';
import statsHandler from './routes/stats.js';
import pertHandler from './routes/pert.js';

// LOGIN 
import { loginHandler, meHandler } from './routes/auth.js';
import { requireAuth } from './middlewares/auth.js';
import activityExportHandler from './routes/activityExport.js';

dotenv.config();

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const app = new Hono();

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
  })
);

// ---------------------------------------------------------------------------
// Routes publiques
// ---------------------------------------------------------------------------
app.get('/health', healthHandler);

// Auth
app.post('/api/auth/login', loginHandler);
app.get('/api/auth/me', requireAuth, meHandler);

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
    -- Utilisateurs
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Table principale plans (nouveau schéma, sans INT[])
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      expected_minutes INT CHECK (expected_minutes > 0),
      actual_minutes INT NULL CHECK (actual_minutes >= 0),
      due_at TIMESTAMPTZ NOT NULL,
      note TEXT NULL,
      depends_on INT NULL REFERENCES plans(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- 💊 Migration douce: si jamais la colonne existe encore en INT[] sur certaines DB
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
        -- on ignore pour ne pas casser le démarrage en dev
        NULL;
    END $$;

    -- Index utiles
    CREATE INDEX IF NOT EXISTS idx_plans_due_at ON plans (due_at);
    CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans (created_at);
  `;
  await pool.query(sql);

  // 🔥 One-shot reset flag (for Railway)
  const shouldReset =
    process.env.RESET_DB_ON_BOOT === '1' ||
    process.env.RESET_DB_ON_BOOT === 'true';

  if (shouldReset) {
    console.log('[Boot] RESET_DB_ON_BOOT enabled → truncating tables…');

    // PG: reset plans
    await pool.query('TRUNCATE TABLE plans RESTART IDENTITY CASCADE;');

    // Mongo: clear projections to stay in sync
    try {
      const db = await getMongoDb();
      await db.collection('plans').deleteMany({});
      await db.collection('events').deleteMany({});
      console.log('[Boot] Mongo projections cleared');
    } catch (e) {
      console.error('[Boot] Failed to reset Mongo projections', e);
    }
  }

  // --- Seed user démo si absent -------------------------------------------
  const demoEmail = process.env.DEMO_EMAIL || 'demo@planwatch.test';
  const demoPassword = process.env.DEMO_PASSWORD || 'BIMBO@123';

  const existing = await pool.query(
    'SELECT 1 FROM users WHERE email = $1',
    [demoEmail],
  );

  if (!existing.rows.length) {
    const hash = await bcrypt.hash(demoPassword, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
      [demoEmail, hash],
    );
    console.log('[PG] Seeded demo user', demoEmail);
  }

  // --- Seed plans (only if table is empty) --------------------------------
  const seedSql = `
    INSERT INTO plans (title, expected_minutes, actual_minutes, due_at, note, depends_on, status)
    SELECT
      title,
      expected_minutes,
      actual_minutes,
      due_at,
      note,
      depends_on,
      status
    FROM (
      VALUES
        -- 1: no dep
        (
          'Define project scope',
          60::INT,
          45::INT,
          (now() - interval '3 days')::TIMESTAMPTZ,
          'Clarify objectives and constraints.'::TEXT,
          NULL::INT,
          'not_started'::TEXT
        ),
        -- 2: depends on 1
        (
          'Gather reference material',
          90::INT,
          80::INT,
          (now() - interval '1 day')::TIMESTAMPTZ,
          'Collect NoSQL papers & docs.'::TEXT,
          1::INT,
          'not_started'::TEXT
        ),
        -- 3: depends on 1
        (
          'Design PlanWatch data model',
          75::INT,
          NULL::INT,
          (now())::TIMESTAMPTZ,
          'Tables for plans, activity, PERT, users.'::TEXT,
          1::INT,
          'not_started'::TEXT
        ),
        -- 4: depends on 2
        (
          'Set up PostgreSQL schema',
          60::INT,
          NULL::INT,
          (now() + interval '1 day')::TIMESTAMPTZ,
          'Apply create.sql & indexes.'::TEXT,
          2::INT,
          'not_started'::TEXT
        ),
        -- 5: depends on 3 (au lieu de 3 & 4, on garde la 1ère)
        (
          'Implement stats & activity API',
          90::INT,
          NULL::INT,
          (now() + interval '2 days')::TIMESTAMPTZ,
          'Hono routes for stats, activity, pert.'::TEXT,
          3::INT,
          'not_started'::TEXT
        ),
        -- 6: depends on 5
        (
          'Build dashboard UI',
          120::INT,
          NULL::INT,
          (now() + interval '4 days')::TIMESTAMPTZ,
          'Cards, tasks board, recent activity.'::TEXT,
          5::INT,
          'not_started'::TEXT
        ),
        -- 7: depends on 5
        (
          'Implement PERT graph',
          110::INT,
          NULL::INT,
          (now() + interval '5 days')::TIMESTAMPTZ,
          'Cytoscape layout + critical path.'::TEXT,
          5::INT,
          'not_started'::TEXT
        ),
        -- 8: depends on 6 (au lieu de 6 & 7, on garde la 1ère)
        (
          'Polish dark/light theme',
          60::INT,
          NULL::INT,
          (now() + interval '7 days')::TIMESTAMPTZ,
          'Background, cards, transitions.'::TEXT,
          6::INT,
          'not_started'::TEXT
        ),
        -- 9: depends on 8
        (
          'Write NoSQL report draft',
          150::INT,
          NULL::INT,
          (now() + interval '10 days')::TIMESTAMPTZ,
          'Explain choices, architecture, tradeoffs.'::TEXT,
          8::INT,
          'not_started'::TEXT
        ),
        -- 10: depends on 8
        (
          'Prepare project demo',
          90::INT,
          NULL::INT,
          (now() + interval '14 days')::TIMESTAMPTZ,
          'Record video + live demo script.'::TEXT,
          8::INT,
          'not_started'::TEXT
        )
    ) AS seed(
      title,
      expected_minutes,
      actual_minutes,
      due_at,
      note,
      depends_on,
      status
    )
    WHERE NOT EXISTS (SELECT 1 FROM plans);
  `;

  await pool.query(seedSql);
}


// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function start() {
  console.log('Boot config', {
    HOST,
    PORT,
    POSTGRES_URL: process.env.POSTGRES_URL,
    MONGO_URL: process.env.MONGO_URL,
    CORS_ORIGIN: ORIGIN,
  });

  // Postgres
  try {
    await pool.query('SELECT 1');
    console.log('[PG] Connection OK');
    await ensureSchema();
    console.log('[PG] Schema OK (with seed)');
  } catch (e) {
    console.error('[PG] Connection or schema FAILED:', e);
  }

  // Mongo
  try {
    await getMongoDb();
    console.log('[Mongo] Connection OK');
  } catch (e) {
    console.error('[Mongo] Connection FAILED:', e);
  }

  console.log('Starting HTTP server…');
  serve({ fetch: app.fetch, port: PORT, hostname: HOST });
}

start().catch((e) => {
  console.error('Fatal error during startup', e);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown() {
  console.log('Shutting down…');
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
