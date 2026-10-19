import type { PoolClient } from 'pg';
import { pool } from './pg.js';
import { getMongoDb } from './mongo.js';
import type { PlanRow } from '../domain/plans.js';

export type TaskEvent = {
  type: 'plan_submitted' | 'plan_updated' | 'plan_deleted';
  at: string; userId: number; planId: number; dependsOn: number | null;
  payload: PlanRow; before: PlanRow | null;
};

export async function ensureOutboxSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_outbox (
      id BIGSERIAL PRIMARY KEY, event JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), delivered_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_outbox_pending ON task_outbox (id) WHERE delivered_at IS NULL;
  `);
}

export async function queueTaskEvent(client: PoolClient, type: TaskEvent['type'], after: PlanRow, before: PlanRow | null = null) {
  const event: TaskEvent = { type, at: new Date().toISOString(), userId: after.userId,
    planId: after.id, dependsOn: after.dependsOn, payload: after, before };
  await client.query('INSERT INTO task_outbox (event) VALUES ($1)', [JSON.stringify(event)]);
}

async function deliverToMongo(eventId: string, event: TaskEvent) {
  const db = await getMongoDb();
  // Retrying a delivered event must not duplicate history.
  await db.collection('events').updateOne(
    { eventId }, { $setOnInsert: { ...event, eventId, at: new Date(event.at) } }, { upsert: true },
  );
  if (event.type === 'plan_deleted') {
    await db.collection('plans').deleteOne({ pgId: event.planId, userId: event.userId });
    await db.collection('plans').updateMany(
      { userId: event.userId, dependsOn: event.planId },
      { $set: { dependsOn: null, updatedAt: new Date(event.at) } },
    );
  } else {
    const { id, ...snapshot } = event.payload;
    await db.collection('plans').updateOne(
      { pgId: id, userId: event.userId },
      { $set: { ...snapshot, dueAt: new Date(snapshot.dueAt), updatedAt: new Date(event.at) } },
      { upsert: true },
    );
  }
}

export async function flushTaskEvents(deliver = deliverToMongo): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A single publisher preserves ordering across server instances.
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(127935, 1) AS acquired');
    if (!lock.rows[0].acquired) { await client.query('COMMIT'); return 0; }
    const { rows } = await client.query<{ id: string; event: TaskEvent }>(
      'SELECT id, event FROM task_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE',
    );
    for (const row of rows) {
      await deliver(row.id, row.event);
      await client.query('UPDATE task_outbox SET delivered_at = now() WHERE id = $1', [row.id]);
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export function startTaskEventWorker() {
  let active: Promise<unknown> | null = null;
  const publish = () => {
    if (active) return;
    active = flushTaskEvents().catch((error) => {
      console.error('[Events] Delivery failed; queued events will be retried.', error);
    }).finally(() => { active = null; });
  };
  publish();
  const timer = setInterval(publish, 3000);
  timer.unref();
  return async () => { clearInterval(timer); await active; };
}
