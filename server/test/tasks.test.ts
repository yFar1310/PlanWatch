import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';
import { Hono } from 'hono';

test('task API and durable event delivery (isolated database schema)', async (t) => {
  assert.ok(process.env.POSTGRES_URL && process.env.MONGO_URL, 'Run using Docker Compose; PostgreSQL and MongoDB URLs are required.');
  const schema = 'pw_test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
  const mongoUrl = new URL(process.env.MONGO_URL);
  mongoUrl.pathname = '/' + schema;
  process.env.MONGO_URL = mongoUrl.toString();
  process.env.PGOPTIONS = `-c search_path=${schema}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const { pool } = await import('../src/db/pg.js');
  const { closeMongo, getMongoDb } = await import('../src/db/mongo.js');
  t.after(async () => {
    await closeMongo();
    const cleanupMongo = await new MongoClient(mongoUrl.toString()).connect();
    try { await cleanupMongo.db().dropDatabase(); } finally { await cleanupMongo.close(); }
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await pool.query(`
    CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);
    CREATE TABLE plans (
      id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
      expected_minutes INT NOT NULL CHECK (expected_minutes > 0), actual_minutes INT NULL,
      due_at TIMESTAMPTZ NOT NULL, note TEXT NULL,
      depends_on INT NULL REFERENCES plans(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'not_started', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      project_id INT NULL, priority INT NOT NULL DEFAULT 0, recurrence_rule TEXT NULL
    );
  `);
  const { ensureOutboxSchema, flushTaskEvents } = await import('../src/db/outbox.js');
  await ensureOutboxSchema();
  const { requireAuth, JWT_SECRET } = await import('../src/middlewares/auth.js');
  const { default: submit } = await import('../src/routes/submit.js');
  const { default: update } = await import('../src/routes/updatePlan.js');
  const { default: remove } = await import('../src/routes/deletePlan.js');
  const { default: get } = await import('../src/routes/getPlan.js');
  const { default: pert } = await import('../src/routes/pert.js');
  const { rows: users } = await pool.query("INSERT INTO users (email) VALUES ('owner@test'), ('other@test') RETURNING id, email");
  const userId = users[0].id;
  const token = jwt.sign({ userId, email: users[0].email }, JWT_SECRET);
  const otherToken = jwt.sign({ userId: users[1].id, email: users[1].email }, JWT_SECRET);
  const app = new Hono();
  app.use('/api/*', requireAuth);
  app.post('/api/submit', submit);
  app.patch('/api/plans/:id', update);
  app.delete('/api/plans/:id', remove);
  app.get('/api/plans/:id', get);
  app.get('/api/pert', pert);
  async function request(path: string, method = 'GET', body?: unknown, access = token) {
    const response = await app.request(path, {
      method, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  const draft = { title: 'A regression task', expectedMinutes: 30, dueAt: '2030-01-01T12:00:00.000Z' };
  let a: number;
  let b: number;

  await t.test('authentication is required', async () => {
    assert.equal((await request('/api/submit', 'POST', draft, '')).status, 401);
  });
  await t.test('create commits a task and its event without contacting MongoDB', async () => {
    const created = await request('/api/submit', 'POST', { ...draft, note: 'Clear me', actualMinutes: 10 });
    assert.equal(created.status, 201);
    a = created.body.plan.id;
    assert.equal(created.body.plan.status, 'not_started', 'Logging time must not silently mark a task done.');
    const queued = await pool.query('SELECT event FROM task_outbox');
    assert.equal(queued.rows.length, 1);
    assert.equal(queued.rows[0].event.payload.title, draft.title);
  });
  await t.test('nullable fields can be cleared and stay cleared on reload', async () => {
    assert.equal((await request(`/api/plans/${a}`, 'PATCH', { note: null, actualMinutes: null })).status, 200);
    const result = await request(`/api/plans/${a}`);
    assert.equal(result.body.plan.note, null);
    assert.equal(result.body.plan.actualMinutes, null);
    assert.equal(result.body.plan.title, draft.title);
  });
  await t.test('a failed event insert rolls back the task insert too', async () => {
    await pool.query(`ALTER TABLE task_outbox ADD CONSTRAINT reject_test_event CHECK (event->'payload'->>'title' <> 'Queue failure test')`);
    try {
      assert.equal((await request('/api/submit', 'POST', { ...draft, title: 'Queue failure test' })).status, 500);
      const result = await pool.query("SELECT count(*)::int AS count FROM plans WHERE title='Queue failure test'");
      assert.equal(result.rows[0].count, 0);
    } finally {
      await pool.query('ALTER TABLE task_outbox DROP CONSTRAINT reject_test_event');
    }
  });
  await t.test('invalid dates, IDs, empty patches, and malformed JSON are client errors', async () => {
    for (const patch of [{ dueAt: 'invalid-date' }, {}, { expectedMinutes: -1 }]) {
      assert.equal((await request(`/api/plans/${a}`, 'PATCH', patch)).status, 400);
    }
    assert.equal((await request('/api/plans/1.5', 'PATCH', { note: 'test' })).status, 400);
    const invalid = await app.request(`/api/plans/${a}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(invalid.status, 400);
    const media = await app.request('/api/submit', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'plain text' });
    assert.equal(media.status, 415);
  });
  await t.test('self-links and dependency cycles are rejected without changing the task', async () => {
    const child = await request('/api/submit', 'POST', { ...draft, title: 'Dependent task', dependsOn: a });
    b = child.body.plan.id;
    assert.equal((await request(`/api/plans/${a}`, 'PATCH', { dependsOn: a })).body.error, 'dependency_cycle');
    assert.equal((await request(`/api/plans/${a}`, 'PATCH', { dependsOn: b })).body.error, 'dependency_cycle');
    assert.equal((await request(`/api/plans/${a}`)).body.plan.dependsOn, null);
  });
  await t.test('omitted dependency remains unchanged and status changes are explicit', async () => {
    const changed = await request(`/api/plans/${b}`, 'PATCH', { actualMinutes: 5 });
    assert.equal(changed.body.plan.dependsOn, a);
    assert.equal(changed.body.plan.status, 'not_started');
    assert.equal((await request(`/api/plans/${b}`, 'PATCH', { status: 'done' })).body.plan.status, 'done');
    assert.equal((await request(`/api/plans/${b}`, 'PATCH', { status: 'not_started' })).body.plan.status, 'not_started');
  });
  await t.test('rescheduling cannot invalidate parent or child deadline order', async () => {
    assert.equal((await request(`/api/plans/${b}`, 'PATCH', { dueAt: '2029-12-31T12:00:00Z' })).body.error, 'invalid_dependency_due_at');
    assert.equal((await request(`/api/plans/${a}`, 'PATCH', { dueAt: '2030-01-02T12:00:00Z' })).body.error, 'invalid_dependent_due_at');
  });
  await t.test('competing dependency edits cannot create a cycle', async () => {
    const c = (await request('/api/submit', 'POST', { ...draft, title: 'Concurrent task C' })).body.plan.id;
    const d = (await request('/api/submit', 'POST', { ...draft, title: 'Concurrent task D' })).body.plan.id;
    const results = await Promise.all([
      request(`/api/plans/${c}`, 'PATCH', { dependsOn: d }),
      request(`/api/plans/${d}`, 'PATCH', { dependsOn: c }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    // Simulate legacy invalid data to verify the map refuses fabricated timings.
    await pool.query('UPDATE plans SET depends_on = CASE WHEN id=$1 THEN $2 ELSE $1 END WHERE id IN ($1,$2)', [c, d]);
    assert.equal((await request('/api/pert')).status, 409);
    await pool.query('UPDATE plans SET depends_on = NULL WHERE id IN ($1,$2)', [c, d]);
  });
  await t.test('another account cannot read, edit, delete, or link the owner\'s task', async () => {
    assert.equal((await request(`/api/plans/${a}`, 'GET', undefined, otherToken)).status, 404);
    assert.equal((await request(`/api/plans/${a}`, 'PATCH', { title: 'Unauthorized change' }, otherToken)).status, 404);
    assert.equal((await request(`/api/plans/${a}`, 'DELETE', undefined, otherToken)).status, 200);
    assert.equal((await request(`/api/plans/${a}`)).status, 200);
    assert.equal((await request('/api/submit', 'POST', { ...draft, dependsOn: a }, otherToken)).body.error, 'dependency_not_found');
  });
  await t.test('delivery failures preserve committed tasks and pending events for retry', async () => {
    await assert.rejects(flushTaskEvents(async () => { throw new Error('Simulated MongoDB outage'); }), /Simulated/);
    const pending = await pool.query('SELECT count(*)::int AS count FROM task_outbox WHERE delivered_at IS NULL');
    assert.ok(pending.rows[0].count > 0);
    assert.equal((await request(`/api/plans/${a}`)).status, 200);
    assert.ok(await flushTaskEvents() > 0);
    assert.equal(await flushTaskEvents(), 0);
  });
  await t.test('replaying after delivery does not duplicate activity', async () => {
    const db = await getMongoDb();
    const beforeCount = await db.collection('events').countDocuments({ userId });
    await pool.query('UPDATE task_outbox SET delivered_at = NULL');
    await flushTaskEvents();
    assert.equal(await db.collection('events').countDocuments({ userId }), beforeCount);
  });
  await t.test('deletion is retryable, keeps a title snapshot, and unlinks dependent tasks', async () => {
    assert.equal((await request(`/api/plans/${a}`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/plans/${a}`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/plans/${a}`)).status, 404);
    assert.equal((await request(`/api/plans/${b}`)).body.plan.dependsOn, null);
    await flushTaskEvents();
    const db = await getMongoDb();
    const events = await db.collection('events').find({ type: 'plan_deleted', planId: a, userId }).toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.title, draft.title);
    assert.equal((await db.collection('plans').findOne({ pgId: b, userId }))?.dependsOn, null);
  });
});
