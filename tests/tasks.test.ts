import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import worker from '../worker';
import { createPdfProbe } from '../worker/pdf';
import { testEnv } from './setup';
import { createTask } from '../worker/tasks';
import { currentDay, nextDay } from '../shared/calendar';

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
  await db.batch([db.prepare('DELETE FROM tasks'), db.prepare('DELETE FROM task_events'), db.prepare('DELETE FROM purged_tasks')]);
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

  it('reschedules and clears calendar dates while recording the before and after values', async () => {
    const task = await add({ plannedDate: '2026-10-19' });
    const moved = await api(`/tasks/${task.id}`, 'PATCH', { version: task.version, plannedDate: '2026-10-20' });
    expect(moved.body.task.plannedDate).toBe('2026-10-20');
    const cleared = await api(`/tasks/${task.id}`, 'PATCH', { version: moved.body.task.version, plannedDate: null });
    expect(cleared.body.task.plannedDate).toBeNull();
    const history = await events(task.id);
    expect(JSON.parse(history[1].before_json as string).plannedDate).toBe('2026-10-19');
    expect(JSON.parse(history[1].after_json as string).plannedDate).toBe('2026-10-20');
    expect(JSON.parse(history[2].after_json as string).plannedDate).toBeNull();
  });

  it('rejects impossible calendar dates in both the API and database', async () => {
    for (const plannedDate of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-2', '0000-01-01']) {
      expect((await api('/tasks', 'POST', { title: 'Invalid date', plannedDate }, crypto.randomUUID())).status).toBe(400);
    }
    const task = await add({ plannedDate: '2028-02-29' });
    await expect(db.prepare("UPDATE tasks SET planned_date='2026-02-30' WHERE id=?").bind(task.id).run()).rejects.toThrow();
    expect((await api(`/tasks/${task.id}`)).body.task.plannedDate).toBe('2028-02-29');
  });

  it('shows open tasks planned for today and overdue work without future, undated, done or deleted tasks', async () => {
    const overdue = await add({ plannedDate: '2026-10-18' });
    const today = await add({ plannedDate: '2026-10-19', status: 'doing' });
    await add({ plannedDate: '2026-10-20' });
    await add();
    await add({ plannedDate: '2026-10-19', status: 'done' });
    const deleted = await add({ plannedDate: '2026-10-19' });
    await api(`/tasks/${deleted.id}`, 'DELETE', { version: deleted.version });
    const result = await api('/tasks?view=today&day=2026-10-19');
    expect(result.body.items.map((task: { id: string }) => task.id).sort()).toEqual([today.id, overdue.id].sort());
    expect((await api('/tasks?view=today')).status).toBe(400);
  });

  it('searches the database beyond the first page and treats wildcard characters literally', async () => {
    const target = await add({ title: 'Read 100% of chapter_1', notes: 'Keep the original notes' });
    for (let i = 0; i < 51; i++) await add({ title: `Newer task ${i}` });
    expect((await api('/tasks')).body.items.some((task: { id: string }) => task.id === target.id)).toBe(false);
    for (const q of ['100%', 'chapter_1', 'ORIGINAL NOTES']) {
      const found = await api(`/tasks?q=${encodeURIComponent(q)}`);
      expect(found.body.items.map((task: { id: string }) => task.id)).toEqual([target.id]);
    }
    expect((await api(`/tasks?q=${encodeURIComponent("' OR 1=1 --")}`)).body.items).toHaveLength(0);
  });

  it('filters statuses on the server before pagination', async () => {
    const done = await add({ status: 'done' });
    await add({ status: 'doing' });
    const todo = await add();
    const result = await api('/tasks?status=done&limit=1');
    expect(result.body.items.map((task: { id: string }) => task.id)).toEqual([done.id]);
    expect(result.body.nextCursor).toBeNull();
    expect((await api('/tasks?status=open')).body.items.some((task: { id: string }) => task.id === todo.id)).toBe(true);
    expect((await api('/tasks?status=unknown')).status).toBe(400);
  });

  it('finds deleted tasks after independent requests and removes them from Trash on restore', async () => {
    const task = await add({ title: 'Keep in Trash', plannedDate: '2026-10-19' });
    await add();
    const deleted = await api(`/tasks/${task.id}`, 'DELETE', { version: task.version });
    const trash = await api('/tasks?view=trash&q=Keep');
    expect(trash.body.items.map((task: { id: string }) => task.id)).toEqual([task.id]);
    expect(trash.body.items[0].deletedAt).toBeTypeOf('number');
    const restored = await api(`/tasks/${task.id}/restore`, 'POST', { version: deleted.body.task.version });
    expect(restored.body.task.plannedDate).toBe('2026-10-19');
    expect((await api('/tasks?view=trash')).body.items).toHaveLength(0);
  });

  it('binds cursors to their filters and supports non-ASCII search cursors', async () => {
    await add({ title: 'A café visit' });
    await add({ title: 'Another café visit' });
    const first = await api('/tasks?q=caf%C3%A9&limit=1');
    const cursor = encodeURIComponent(first.body.nextCursor);
    const second = await api(`/tasks?q=caf%C3%A9&limit=1&cursor=${cursor}`);
    expect(second.status).toBe(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect((await api(`/tasks?view=trash&cursor=${cursor}`)).status).toBe(400);
  });

  it('preserves old creation keys across the date migration and rejects changed planned dates', async () => {
    const key = crypto.randomUUID();
    const saved = await api('/tasks', 'POST', { title: 'Existing task' }, key);
    await db.prepare("UPDATE tasks SET creation_payload=json_remove(creation_payload, '$.plannedDate') WHERE id=?").bind(saved.body.task.id).run();
    const count = (await events(saved.body.task.id)).length;
    const replay = await api('/tasks', 'POST', { title: 'Existing task' }, key);
    expect(replay.status).toBe(200);
    expect(replay.body.task.id).toBe(saved.body.task.id);
    expect(await events(saved.body.task.id)).toHaveLength(count);
    expect((await api('/tasks', 'POST', { title: 'Existing task', plannedDate: '2026-10-19' }, key)).status).toBe(409);
  });

  it('uses Paris calendar days across both daylight-saving transitions', () => {
    expect(currentDay(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
    expect(currentDay(new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30');
    expect(currentDay(new Date('2026-10-25T22:30:00Z'))).toBe('2026-10-25');
    expect(currentDay(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
    expect(nextDay('2026-03-29')).toBe('2026-03-30');
    expect(nextDay('2026-10-25')).toBe('2026-10-26');
  });

  it('replays a create even if its original dependency was deleted afterward', async () => {
    const parent = await add();
    const key = crypto.randomUUID();
    const input = { title: 'A dependent task', dependsOn: parent.id, plannedDate: '2026-10-19' };
    const created = await api('/tasks', 'POST', input, key);
    await api(`/tasks/${parent.id}`, 'DELETE', { version: parent.version });
    const count = (await events(created.body.task.id)).length;
    const replay = await api('/tasks', 'POST', input, key);
    expect(replay.status).toBe(200);
    expect(replay.body.task.id).toBe(created.body.task.id);
    expect(replay.body.task.dependsOn).toBeNull();
    expect(await events(created.body.task.id)).toHaveLength(count);
  });

  it('paginates Trash by deletion time rather than original creation time', async () => {
    const first = await add();
    const second = await add();
    const third = await add();
    for (const task of [third, first, second]) await api(`/tasks/${task.id}`, 'DELETE', { version: task.version });
    await db.prepare('UPDATE tasks SET deleted_at = CASE id WHEN ? THEN 1000 WHEN ? THEN 2000 ELSE 3000 END').bind(third.id, first.id).run();
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await api(`/tasks?view=trash&limit=1${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      found.push(...page.body.items.map((task: { id: string }) => task.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(found).toEqual([second.id, first.id, third.id]);
  });
});

describe('priorities and prerequisite completion', () => {
  it('defaults old and new tasks to Medium and records priority changes in history', async () => {
    const task = await add(); expect(task.priority).toBe('medium');
    const changed = await api(`/tasks/${task.id}`,'PATCH',{version:task.version,priority:'urgent'});
    expect(changed.status).toBe(200); expect(changed.body.task.priority).toBe('urgent');
    const log=await events(task.id);
    expect(JSON.parse(log[0].after_json as string).priority).toBe('medium');
    expect(JSON.parse(log[1].before_json as string).priority).toBe('medium');
    expect(JSON.parse(log[1].after_json as string).priority).toBe('urgent');
    expect((await api('/tasks','POST',{title:'Invalid priority',priority:'critical'},crypto.randomUUID())).status).toBe(400);
    await expect(db.prepare("UPDATE tasks SET priority='critical' WHERE id=?").bind(task.id).run()).rejects.toThrow();
  });
  it('filters priorities before pagination and binds the cursor to that priority', async () => {
    const high=await add({priority:'high'});
    await add({priority:'urgent'}); await add({priority:'urgent'});
    for(let i=0;i<52;i++) await add({priority:'low'});
    expect((await api('/tasks?priority=high')).body.items.map((t:any)=>t.id)).toEqual([high.id]);
    const first=await api('/tasks?priority=urgent&limit=1');
    expect(first.body.items[0].priority).toBe('urgent');
    const second=await api('/tasks?priority=urgent&limit=1&cursor='+encodeURIComponent(first.body.nextCursor));
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect((await api('/tasks?priority=low&cursor='+encodeURIComponent(first.body.nextCursor))).body.error).toBe('invalid_cursor');
    expect((await api('/tasks?priority=critical')).status).toBe(400);
  });
  it('keeps create retries compatible with records from before priorities existed', async () => {
    const key=crypto.randomUUID(); const task=await api('/tasks','POST',{title:'Legacy request'},key);
    await db.prepare("UPDATE tasks SET creation_payload=json_remove(creation_payload,'$.priority') WHERE id=?").bind(task.body.task.id).run();
    expect((await api('/tasks','POST',{title:'Legacy request'},key)).status).toBe(200);
    expect((await api('/tasks','POST',{title:'Legacy request',priority:'high'},key)).status).toBe(409);
  });
  it('blocks completion until the prerequisite is done and permits removing a dependency', async () => {
    const parent=await add({title:'Prerequisite'}), child=await add({dependsOn:parent.id});
    expect(child.dependencyTitle).toBe('Prerequisite'); expect(child.dependencyStatus).toBe('todo');
    const failed=await api(`/tasks/${child.id}`,'PATCH',{version:child.version,status:'done'});
    expect(failed.status).toBe(409); expect(failed.body.error).toBe('dependency_incomplete');
    expect(await events(child.id)).toHaveLength(1);
    expect((await api('/tasks','POST',{title:'Cannot finish',status:'done',dependsOn:parent.id},crypto.randomUUID())).body.error).toBe('dependency_incomplete');
    await api(`/tasks/${parent.id}`,'PATCH',{version:parent.version,status:'done'});
    expect((await api(`/tasks/${child.id}`)).body.task.dependencyStatus).toBe('done');
    expect((await api(`/tasks/${child.id}`,'PATCH',{version:child.version,status:'done'})).status).toBe(200);
    const independent=await add({dependsOn:child.id});
    expect((await api(`/tasks/${independent.id}`,'PATCH',{version:independent.version,dependsOn:null})).body.task.dependsOn).toBeNull();
  });
  it('deletes and restores a completed task with its priority and completion time intact', async () => {
    const done=await add({status:'done',priority:'urgent',notes:'Keep the details'});
    const deleted=await api(`/tasks/${done.id}`,'DELETE',{version:done.version});
    expect(deleted.status).toBe(200);
    expect((await api('/tasks?status=done')).body.items).toHaveLength(0);
    expect((await api('/tasks?view=trash&priority=urgent')).body.items[0].id).toBe(done.id);
    const restored=await api(`/tasks/${done.id}/restore`,'POST',{version:deleted.body.task.version});
    expect(restored.body.task).toMatchObject({status:'done',priority:'urgent',completedAt:done.completedAt,notes:'Keep the details'});
  });
});

describe('permanent Trash deletion', () => {
  async function trash(input:Record<string,unknown>={}){const task=await add(input);return(await api(`/tasks/${task.id}`,'DELETE',{version:task.version})).body.task;}
  it('requires confirmation and refuses live or stale tasks', async () => {
    const live=await add(),deleted=await trash();
    expect((await api(`/trash/${deleted.id}`,'DELETE',{version:deleted.version})).status).toBe(400);
    expect((await api(`/trash/${live.id}`,'DELETE',{version:live.version,confirmed:true})).status).toBe(409);
    expect((await api(`/trash/${deleted.id}`,'DELETE',{version:deleted.version-1,confirmed:true})).status).toBe(409);
    expect((await api('/trash/summary')).body.count).toBe(1);
  });
  it('erases one task and its content history and prevents replay from recreating it', async () => {
    const key=crypto.randomUUID();const created=await api('/tasks','POST',{title:'Erase this content',notes:'Private history'},key);
    const deleted=(await api(`/tasks/${created.body.task.id}`,'DELETE',{version:1})).body.task;
    const result=await api(`/trash/${deleted.id}`,'DELETE',{version:deleted.version,confirmed:true});
    expect(result.body).toEqual({deleted:1,ids:[deleted.id]});expect(await events(deleted.id)).toHaveLength(0);
    expect((await api(`/tasks/${deleted.id}/restore`,'POST',{version:deleted.version})).status).toBe(404);
    const tombstone=await db.prepare('SELECT * FROM purged_tasks WHERE task_id=?').bind(deleted.id).first();
    expect(tombstone).toMatchObject({owner_id:'local-preview',creation_key:key});
    expect(JSON.stringify(tombstone)).not.toContain('Erase this content');expect(JSON.stringify(tombstone)).not.toContain('Private history');
    expect((await api('/tasks','POST',{title:'Erase this content',notes:'Private history'},key)).status).toBe(410);
    expect((await api('/tasks?view=trash')).body.items).toHaveLength(0);
    expect((await api('/tasks','POST',{title:'Erase this content',notes:'Private history'},crypto.randomUUID())).status).toBe(201);
  });
  it('deletes only the chosen tasks atomically and keeps the others', async () => {
    const a=await trash(),b=await trash(),c=await trash();
    const result=await api('/trash/purge','POST',{items:[a,b].map(t=>({id:t.id,version:t.version})),confirmed:true});
    expect(result.body.deleted).toBe(2);expect((await api('/tasks?view=trash')).body.items.map((t:any)=>t.id)).toEqual([c.id]);
    expect(await events(a.id)).toHaveLength(0);expect(await events(b.id)).toHaveLength(0);expect(await events(c.id)).toHaveLength(2);
    expect((await api('/trash/purge','POST',{items:[{id:c.id,version:c.version},{id:c.id,version:c.version}],confirmed:true})).status).toBe(400);
  });
  it('does not delete any selected task when one was restored elsewhere', async () => {
    const a=await trash(),b=await trash();await api(`/tasks/${b.id}/restore`,'POST',{version:b.version});
    const result=await api('/trash/purge','POST',{items:[a,b].map(t=>({id:t.id,version:t.version})),confirmed:true});
    expect(result.status).toBe(409);expect((await api('/tasks?view=trash')).body.items.map((t:any)=>t.id)).toEqual([a.id]);
    expect((await api(`/tasks/${b.id}`)).status).toBe(200);expect(await events(a.id)).toHaveLength(2);
  });
  it('empties all pages and priorities but preserves tasks changed after confirmation', async () => {
    const ids=[];for(let i=0;i<53;i++)ids.push((await trash({priority:i%2?'high':'low'})).id);
    const live=await add();const summary=(await api('/trash/summary')).body;expect(summary.count).toBe(53);
    const newer=await trash();const again=(await db.prepare('SELECT id,version FROM tasks WHERE id=?').bind(ids[52]).first<{id:string;version:number}>())!;
    const restored=(await api(`/tasks/${again.id}/restore`,'POST',{version:again.version})).body.task;
    const reDeleted=(await api(`/tasks/${again.id}`,'DELETE',{version:restored.version})).body.task;
    const result=await api('/trash/empty','POST',{cutoff:summary.cutoff,confirmed:true});expect(result.body.deleted).toBe(52);
    expect((await api('/tasks?view=trash')).body.items.map((t:any)=>t.id).sort()).toEqual([newer.id,reDeleted.id].sort());
    expect((await api(`/tasks/${live.id}`)).status).toBe(200);
  });
  it('rolls back the entire purge if history cleanup fails', async () => {
    const a=await trash();await db.prepare(`CREATE TRIGGER reject_purge BEFORE DELETE ON task_events WHEN OLD.task_id='${a.id}' BEGIN SELECT RAISE(ABORT,'simulated_purge_failure'); END`).run();
    try{expect((await api(`/trash/${a.id}`,'DELETE',{version:a.version,confirmed:true})).status).toBe(500);expect((await api('/trash/summary')).body.count).toBe(1);expect(await events(a.id)).toHaveLength(2);expect(await db.prepare('SELECT 1 FROM purged_tasks WHERE task_id=?').bind(a.id).first()).toBeNull();}
    finally{await db.prepare('DROP TRIGGER reject_purge').run();}
  });
});

describe('task schedules and timeline queries', () => {
  it('validates dates, time pairs, ordering and one-day time slots in the API and database', async () => {
    for(const schedule of [{plannedEndDate:'2026-10-20'},{plannedDate:'2026-10-20',plannedEndDate:'2026-10-19'},{plannedDate:'2026-10-20',startTime:'09:00'},{plannedDate:'2026-10-20',startTime:'24:00',endTime:'25:00'},{plannedDate:'2026-10-20',startTime:'11:00',endTime:'10:00'},{plannedDate:'2026-10-20',plannedEndDate:'2026-10-21',startTime:'09:00',endTime:'10:00'},{plannedDate:'2026-10-20',plannedEndDate:'2026-02-30'}])expect((await api('/tasks','POST',{title:'Bad schedule',...schedule},crypto.randomUUID())).status).toBe(400);
    const task=await add({plannedDate:'2026-10-20',startTime:'09:30',endTime:'10:15'});
    expect((await api(`/tasks/${task.id}`,'PATCH',{version:task.version,plannedDate:null})).status).toBe(400);
    await expect(db.prepare("UPDATE tasks SET end_time='08:00' WHERE id=?").bind(task.id).run()).rejects.toThrow();
    expect((await api(`/tasks/${task.id}`)).body.task.startTime).toBe('09:30');
    const cleared=await api(`/tasks/${task.id}`,'PATCH',{version:task.version,plannedDate:null,plannedEndDate:null,startTime:null,endTime:null});expect(cleared.status).toBe(200);
  });
  it('records schedule edits in snapshots and preserves them across Trash restoration', async () => {
    const task=await add({plannedDate:'2026-10-20',plannedEndDate:'2026-10-23'});
    const changed=(await api(`/tasks/${task.id}`,'PATCH',{version:1,plannedEndDate:null,startTime:'09:00',endTime:'10:00'})).body.task;
    const log=await events(task.id);expect(JSON.parse(log[1].before_json as string).plannedEndDate).toBe('2026-10-23');expect(JSON.parse(log[1].after_json as string).startTime).toBe('09:00');
    const deleted=(await api(`/tasks/${task.id}`,'DELETE',{version:changed.version})).body.task;
    expect((await api(`/tasks/${task.id}/restore`,'POST',{version:deleted.version})).body.task).toMatchObject({startTime:'09:00',endTime:'10:00',plannedDate:'2026-10-20'});
  });
  it('returns overlapping multi-day tasks, dates and times with filters before pagination', async () => {
    const spanning=await add({title:'Long plan',plannedDate:'2026-10-01',plannedEndDate:'2026-10-31',priority:'high'});
    const timed=await add({title:'Meeting',plannedDate:'2026-10-20',startTime:'08:00',endTime:'09:00'});
    await add({plannedDate:'2026-10-18'});await add({plannedDate:'2026-10-26'});await add();
    const deleted=await add({plannedDate:'2026-10-20'});await api(`/tasks/${deleted.id}`,'DELETE',{version:1});
    const page=await api('/timeline?from=2026-10-19&to=2026-10-25');expect(page.body.items.map((t:any)=>t.id)).toEqual([spanning.id,timed.id]);expect(page.body.unscheduledCount).toBe(1);
    expect((await api('/timeline?from=2026-10-19&to=2026-10-25&priority=high')).body.items.map((t:any)=>t.id)).toEqual([spanning.id]);
    expect((await api('/timeline?from=2026-10-19&to=2026-10-25&q=meeting')).body.items.map((t:any)=>t.id)).toEqual([timed.id]);
    expect((await api('/timeline?from=2026-10-25&to=2026-10-19')).status).toBe(400);expect((await api('/timeline?from=2026-01-01&to=2026-12-31')).status).toBe(400);
  });
  it('paginates schedules with tied dates and rejects range/filter cursor reuse', async () => {
    for(let i=0;i<103;i++)await add({plannedDate:'2026-10-20'});
    const first=await api('/timeline?from=2026-10-19&to=2026-10-25');expect(first.body.items).toHaveLength(100);
    const next='&cursor='+encodeURIComponent(first.body.nextCursor);
    const second=await api('/timeline?from=2026-10-19&to=2026-10-25'+next);expect(second.body.items).toHaveLength(3);expect(new Set([...first.body.items,...second.body.items].map((t:any)=>t.id)).size).toBe(103);
    expect((await api('/timeline?from=2026-10-20&to=2026-10-25'+next)).status).toBe(400);expect((await api('/timeline?from=2026-10-19&to=2026-10-25&priority=high'+next)).status).toBe(400);
  });
  it('preserves create retries from before schedule fields existed', async () => {
    const key=crypto.randomUUID();const created=await api('/tasks','POST',{title:'Legacy capture',plannedDate:'2026-10-20'},key);
    await db.prepare("UPDATE tasks SET creation_payload=json_remove(creation_payload,'$.plannedEndDate','$.startTime','$.endTime') WHERE id=?").bind(created.body.task.id).run();
    expect((await api('/tasks','POST',{title:'Legacy capture',plannedDate:'2026-10-20'},key)).status).toBe(200);
    expect((await api('/tasks','POST',{title:'Legacy capture',plannedDate:'2026-10-20',startTime:'09:00',endTime:'10:00'},key)).status).toBe(409);
  });
});
