// server/src/index.ts
import dotenv from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';

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
// Routes
// ---------------------------------------------------------------------------
app.get('/health', healthHandler);
app.post('/api/submit', submitHandler);

app.get('/api/plans', listPlansHandler);
app.get('/api/plans/:id', getPlanHandler);
app.patch('/api/plans/:id', updatePlanHandler);
app.delete('/api/plans/:id', deletePlanHandler);

app.get('/api/stats', statsHandler);
app.get('/api/activity', activityHandler);
app.get('/api/pert', pertHandler);

// ---------------------------------------------------------------------------
// Schema + seed (Postgres)
// ---------------------------------------------------------------------------
async function ensureSchema() {
  const sql = `
    -- Table principale
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      expected_minutes INT CHECK (expected_minutes > 0),
      actual_minutes INT NULL CHECK (actual_minutes >= 0),
      due_at TIMESTAMPTZ NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Colonne deps pour PERT (liste d'ids de tâches)
    ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS depends_on INT[] NOT NULL DEFAULT ARRAY[]::INT[];

    -- Colonne status
    ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

    -- Index utiles
    CREATE INDEX IF NOT EXISTS idx_plans_due_at ON plans (due_at);
    CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans (created_at);
  `;
  await pool.query(sql);

  // Seed de base si la table est vide (3 tâches)
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
        (
          'Define project scope',
          30::INT,
          NULL::INT,
          (now() - interval '3 days')::TIMESTAMPTZ,
          'High-level objectives and constraints.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Research existing tools',
          45::INT,
          NULL::INT,
          (now() - interval '2 days')::TIMESTAMPTZ,
          'Look at Notion, Linear, etc.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Prepare NoSQL report',
          120::INT,
          NULL::INT,
          (now() - interval '1 day')::TIMESTAMPTZ,
          'Outline sections and main ideas.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Design PlanWatch data model',
          60::INT,
          NULL::INT,
          (now())::TIMESTAMPTZ,
          'Postgres schema + Mongo events.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Implement backend API',
          90::INT,
          NULL::INT,
          (now() + interval '1 day')::TIMESTAMPTZ,
          'Hono routes, validation and CORS.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Implement PlanWatch PERT',
          90::INT,
          NULL::INT,
          (now() + interval '2 days')::TIMESTAMPTZ,
          'Refine PERT algorithm and UI.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Implement dashboard cards',
          50::INT,
          NULL::INT,
          (now() + interval '3 days')::TIMESTAMPTZ,
          'Today / Upcoming / Activity.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Implement tasks board',
          70::INT,
          NULL::INT,
          (now() + interval '4 days')::TIMESTAMPTZ,
          'Not started / In progress / Done.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Refactor dashboard UI',
          60::INT,
          NULL::INT,
          (now() + interval '5 days')::TIMESTAMPTZ,
          'Polish cards, colors and animations.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Polish dark mode theme',
          45::INT,
          NULL::INT,
          (now() + interval '6 days')::TIMESTAMPTZ,
          'Fine-tune background and contrasts.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Write project documentation',
          80::INT,
          NULL::INT,
          (now() + interval '7 days')::TIMESTAMPTZ,
          'README + technical notes.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
        ),
        (
          'Final QA & presentation',
          90::INT,
          NULL::INT,
          (now() + interval '8 days')::TIMESTAMPTZ,
          'Manual tests + slides.'::TEXT,
          ARRAY[]::INT[],
          'active'::TEXT
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

    -- Dépendances pour PERT (on les pose par titre, donc pas besoin de connaître les IDs)
    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Define project scope')]
    WHERE p.title = 'Research existing tools';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Research existing tools')]
    WHERE p.title = 'Prepare NoSQL report';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Prepare NoSQL report')]
    WHERE p.title = 'Design PlanWatch data model';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Design PlanWatch data model')]
    WHERE p.title = 'Implement backend API';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Implement backend API')]
    WHERE p.title = 'Implement PlanWatch PERT';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Implement backend API')]
    WHERE p.title = 'Implement dashboard cards';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Implement dashboard cards')]
    WHERE p.title = 'Implement tasks board';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Implement tasks board')]
    WHERE p.title = 'Refactor dashboard UI';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Refactor dashboard UI')]
    WHERE p.title = 'Polish dark mode theme';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Polish dark mode theme')]
    WHERE p.title = 'Write project documentation';

    UPDATE plans p
    SET depends_on = ARRAY[(SELECT id FROM plans WHERE title = 'Write project documentation')]
    WHERE p.title = 'Final QA & presentation';
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
