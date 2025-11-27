// server/src/index.ts
import dotenv from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import healthHandler from './routes/health.js';
import submitHandler from './routes/submit.js';
import { pool } from './db/pg.js';
import { getMongoDb, closeMongo } from './db/mongo.js';
import listPlansHandler from './routes/plans.js';
import getPlanHandler from './routes/getPlan.js'
import updatePlanHandler from './routes/updatePlan.js'
import deletePlanHandler from './routes/deletePlan.js'
import activityHandler from './routes/activity.js';
import statsHandler from './routes/stats.js';
import pertHandler from './routes/pert.js'
import { cors } from 'hono/cors';
dotenv.config();

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const app = new Hono();

// Security & CORS
app.use(
  '*',
  cors({
    origin: 'http://localhost:5173',               // ou une fonction si tu veux whitelister
    allowMethods: ['GET','POST','PATCH','DELETE','OPTIONS'],
    allowHeaders: ['Content-Type','Authorization'],
    maxAge: 86400,
  })
);

app.get('/health', healthHandler);
app.post('/api/submit', submitHandler);
app.get('/api/plans', listPlansHandler);
app.get('/api/plans/:id', getPlanHandler);
app.patch('/api/plans/:id', updatePlanHandler);
app.delete('/api/plans/:id', deletePlanHandler);

// Stats & Activities
app.get('/api/stats', statsHandler);
app.get('/api/activity', activityHandler);

// Méthode PERT
app.get('/api/pert', pertHandler);


// DB schema (index utile pour les requêtes par date)
async function ensureSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      expected_minutes INT CHECK (expected_minutes > 0),
      actual_minutes INT NULL CHECK (actual_minutes >= 0),
      due_at TIMESTAMPTZ NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_plans_due_at ON plans (due_at);
    CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans (created_at);
  `;
  await pool.query(sql);
}

async function start() {
  try {
    await pool.query('SELECT 1');
    await getMongoDb();
    await ensureSchema();
    console.log('DBs ready. Starting server…');
    serve({ fetch: app.fetch, port: PORT, hostname: HOST });
  } catch (e) {
    console.error('Failed to start', e);
    process.exit(1);
  }
}
start();

// graceful shutdown
async function shutdown() {
  console.log('Shutting down…');
  try { await pool.end(); } catch {}
  try { await closeMongo(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
