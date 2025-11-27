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

    -- Colonne status (pour filtrage éventuel : active / archived, etc.)
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
    SELECT title, expected_minutes, actual_minutes, due_at, note, depends_on, status
    FROM (
      VALUES
        (
          'Prepare NoSQL report',
          120,
          NULL,
          now() + interval '1 day',
          'Outline sections and main ideas.',
          ARRAY[]::INT[],
          'active'
        ),
        (
          'Implement PlanWatch PERT',
          90,
          NULL,
          now() + interval '2 days',
          'Refine PERT algorithm and UI.',
          ARRAY[]::INT[],
          'active'
        ),
        (
          'Refactor dashboard UI',
          60,
          NULL,
          now() + interval '3 days',
          'Polish cards, colors and animations.',
          ARRAY[]::INT[],
          'active'
        )
    ) AS seed(title, expected_minutes, actual_minutes, due_at, note, depends_on, status)
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
