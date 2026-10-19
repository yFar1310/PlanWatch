import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import worker from '../worker';
import { createPdfProbe } from '../worker/pdf';
import { testEnv } from './setup';
import { createTask } from '../worker/tasks';

const db = testEnv.DB;
async function api(path: string, method = 'GET', input?: unknown, key?: string) {
  const res = await worker.request(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  }, testEnv);
  return { status: res.status, body: await res.json() as any };
}
async function add(input: Record<string, unknown> = {}) {
  const result = await api('/tasks', 'POST', { title: 'A task worth doing', ...input }, crypto.randomUUID());
  expect(result.status).toBe(201);
  return result.body.task;
}
async function events(id: string) {
  return (await db.prepare('SELECT * FROM task_events WHERE task_id=? ORDER BY id').bind(id).all()).results;
}

beforeEach(async () => {
  await db.batch([db.prepare('DELETE FROM tasks'), db.prepare('DELETE FROM task_events')]);
});

describe('task foundation in the real Workers runtime', () => {
  it('keeps APIs closed without the local-only flag', async () => {
    const res = await worker.request('/api/tasks', {}, { ...testEnv, LOCAL_DEV: 'false' });
    expect(res.status).toBe(503);
    const publicHost = await worker.request('https://planwatch.example/api/tasks', {}, testEnv);
    expect(publicHost.status).toBe(503);
  });

  it('rejects requests from another origin', async () => {
    const res = await worker.request('/api/tasks', {
      method: 'POST', headers: { Origin: 'https://another.example', 'Content-Type': 'application/json' }, body: '{}',
    }, testEnv);
    expect(res.status).toBe(403);
  });

  it('creates a title-only task and persists its snapshot atomically', async () => {
    const task = await add({ title: 'CV' });
    const reloaded = await api(`/tasks/${task.id}`);
    expect(reloaded.body.task).toEqual(task);
    expect(task.status).toBe('todo');
    expect(task.estimateMinutes).toBeNull();
    expect(JSON.parse((await events(task.id))[0].after_json as string).title).toBe('CV');
  });

  it('retries a lost create response without duplicating the task or its history', async () => {
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      api('/tasks', 'POST', { title: 'One task, two requests' }, key),
      api('/tasks', 'POST', { title: 'One task, two requests' }, key),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.task.id).toBe(b.body.task.id);
    expect(await events(a.body.task.id)).toHaveLength(1);
    expect((await api('/tasks', 'POST', { title: 'Different content' }, key)).status).toBe(409);
  });

  it('rolls back creation if the activity record cannot be written', async () => {
    await db.prepare(`CREATE TRIGGER test_reject_event BEFORE INSERT ON task_events
      WHEN json_extract(NEW.after_json, '$.title') = 'Atomic failure'
      BEGIN SELECT RAISE(ABORT, 'simulated_event_failure'); END`).run();
    try {
      expect((await api('/tasks', 'POST', { title: 'Atomic failure' }, crypto.randomUUID())).status).toBe(500);
      expect((await db.prepare("SELECT count(*) AS count FROM tasks WHERE title='Atomic failure'").first<{ count: number }>())?.count).toBe(0);
    } finally { await db.prepare('DROP TRIGGER test_reject_event').run(); }
  });

  it('clears optional fields without changing omitted values or silently completing work', async () => {
    const task = await add({ notes: 'Some context', actualMinutes: 15, estimateMinutes: 30 });
    expect(task.status).toBe('todo');
    const result = await api(`/tasks/${task.id}`, 'PATCH', { version: task.version, notes: null, actualMinutes: null });
    expect(result.status).toBe(200);
    expect(result.body.task.notes).toBeNull();
    expect(result.body.task.actualMinutes).toBeNull();
    expect(result.body.task.estimateMinutes).toBe(30);
    expect(result.body.task.title).toBe(task.title);
  });

  it('rolls back edits when their history cannot be saved', async () => {
    const task = await add();
    await db.prepare(`CREATE TRIGGER test_reject_update BEFORE INSERT ON task_events
      WHEN NEW.kind = 'updated' BEGIN SELECT RAISE(ABORT, 'simulated_event_failure'); END`).run();
    try {
      expect((await api(`/tasks/${task.id}`, 'PATCH', { version: task.version, title: 'Unsaved change' })).status).toBe(500);
      expect((await api(`/tasks/${task.id}`)).body.task).toEqual(task);
      expect(await events(task.id)).toHaveLength(1);
    } finally { await db.prepare('DROP TRIGGER test_reject_update').run(); }
  });

  it('rolls back a deletion and all dependency changes if a child history write fails', async () => {
    const parent = await add();
    const child = await add({ dependsOn: parent.id });
    await db.prepare(`CREATE TRIGGER test_reject_unlink BEFORE INSERT ON task_events
      WHEN NEW.kind = 'updated' BEGIN SELECT RAISE(ABORT, 'simulated_event_failure'); END`).run();
    try {
      expect((await api(`/tasks/${parent.id}`, 'DELETE', { version: parent.version })).status).toBe(500);
      expect((await api(`/tasks/${parent.id}`)).body.task).toEqual(parent);
      expect((await api(`/tasks/${child.id}`)).body.task).toEqual(child);
      expect(await events(parent.id)).toHaveLength(1);
      expect(await events(child.id)).toHaveLength(1);
    } finally { await db.prepare('DROP TRIGGER test_reject_unlink').run(); }
  });

  it('records completion time and clears it when reopened', async () => {
    const task = await add();
    const done = await api(`/tasks/${task.id}`, 'PATCH', { version: task.version, status: 'done' });
    expect(done.body.task.completedAt).toBeTypeOf('number');
    const reopened = await api(`/tasks/${task.id}`, 'PATCH', { version: done.body.task.version, status: 'todo' });
    expect(reopened.body.task.completedAt).toBeNull();
  });

  it('prevents stale saves from overwriting newer changes', async () => {
    const task = await add();
    const [a, b] = await Promise.all([
      api(`/tasks/${task.id}`, 'PATCH', { version: task.version, title: 'Edit A' }),
      api(`/tasks/${task.id}`, 'PATCH', { version: task.version, title: 'Edit B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await events(task.id)).toHaveLength(2);
  });

  it('rejects self-dependencies and longer dependency cycles', async () => {
    const a = await add();
    const b = await add({ dependsOn: a.id });
    const c = await add({ dependsOn: b.id });
    expect((await api(`/tasks/${a.id}`, 'PATCH', { version: a.version, dependsOn: a.id })).body.error).toBe('dependency_cycle');
    expect((await api(`/tasks/${a.id}`, 'PATCH', { version: a.version, dependsOn: c.id })).body.error).toBe('dependency_cycle');
    expect(await events(a.id)).toHaveLength(1);
  });

  it('rejects a cycle introduced by simultaneous edits on different tasks', async () => {
    const a = await add();
    const b = await add();
    const result = await Promise.all([
      api(`/tasks/${a.id}`, 'PATCH', { version: a.version, dependsOn: b.id }),
      api(`/tasks/${b.id}`, 'PATCH', { version: b.version, dependsOn: a.id }),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('does not expose or link another owner\'s tasks', async () => {
    const foreign = await createTask(db, 'another-owner', crypto.randomUUID(), { title: 'Private task' });
    expect((await api(`/tasks/${foreign.task.id}`)).status).toBe(404);
    expect((await api(`/tasks/${foreign.task.id}`, 'DELETE', { version: 1 })).status).toBe(404);
    expect((await api('/tasks', 'POST', { title: 'Invalid dependency', dependsOn: foreign.task.id }, crypto.randomUUID())).body.error).toBe('dependency_not_found');
    expect((await api('/tasks')).body.items).toHaveLength(0);
  });

  it('soft-deletes, unlinks dependents, and restores without duplicating delete events', async () => {
    const parent = await add({ notes: 'Keep this information' });
    const child = await add({ dependsOn: parent.id });
    const removed = await api(`/tasks/${parent.id}`, 'DELETE', { version: parent.version });
    expect(removed.status).toBe(200);
    expect((await api(`/tasks/${parent.id}`)).status).toBe(404);
    expect((await api(`/tasks/${child.id}`)).body.task.dependsOn).toBeNull();
    expect((await api(`/tasks/${parent.id}`, 'DELETE', { version: parent.version })).status).toBe(200);
    const restored = await api(`/tasks/${parent.id}/restore`, 'POST', { version: removed.body.task.version });
    expect(restored.body.task.notes).toBe('Keep this information');
    expect(restored.body.task.deletedAt).toBeNull();
    expect((await events(parent.id)).map((e) => e.kind)).toEqual(['created', 'deleted', 'restored']);
  });

  it('paginates every record even when creation timestamps tie', async () => {
    for (let i = 0; i < 7; i++) await add({ title: `Page task ${i}` });
    await db.prepare('UPDATE tasks SET created_at=1000').run();
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await api(`/tasks?limit=2${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      ids.push(...page.body.items.map((task: { id: string }) => task.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });

  it('returns useful validation errors for invalid inputs', async () => {
    expect((await api('/tasks', 'POST', { title: '   ' }, crypto.randomUUID())).status).toBe(400);
    expect((await api('/tasks', 'POST', { title: 'Good title', actualMinutes: -1 }, crypto.randomUUID())).status).toBe(400);
    expect((await api('/tasks?limit=not-a-number')).status).toBe(400);
    expect((await api('/tasks?cursor=invalid')).status).toBe(400);
    const task = await add();
    expect((await api(`/tasks/${task.id}`, 'PATCH', { version: task.version })).status).toBe(400);
  });

  it('creates and parses a PDF without Node filesystem or browser services', async () => {
    const bytes = await createPdfProbe();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
