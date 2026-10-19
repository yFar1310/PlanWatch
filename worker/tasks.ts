import { z } from 'zod';
import type { Task, TaskPage } from '../shared/tasks';

export class Problem extends Error {
  constructor(public code: string, message: string, public status: 400 | 404 | 409 | 415 = 400) { super(message); }
}

const taskFields = z.object({
  title: z.string().trim().min(1, 'Give the task a title.').max(200),
  notes: z.string().trim().max(5000).nullable(),
  status: z.enum(['todo', 'doing', 'done']),
  estimateMinutes: z.number().int().positive().nullable(),
  actualMinutes: z.number().int().nonnegative().nullable(),
  dependsOn: z.uuid().nullable(),
});

export const createSchema = taskFields.partial().required({ title: true }).strict();
export const patchSchema = taskFields.partial().extend({ version: z.number().int().positive() }).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'version'), 'Change at least one task field.',
);
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
export const idSchema = z.uuid();

const columns = `id, title, notes, status, estimate_minutes AS estimateMinutes,
  actual_minutes AS actualMinutes, depends_on AS dependsOn, created_at AS createdAt,
  updated_at AS updatedAt, completed_at AS completedAt, deleted_at AS deletedAt, version`;

export async function getTask(db: D1Database, owner: string, id: string, includeDeleted = false) {
  const task = await db.prepare(`SELECT ${columns} FROM tasks WHERE owner_id=? AND id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`)
    .bind(owner, id).first<Task>();
  if (!task) throw new Problem('not_found', 'This task is no longer available.', 404);
  return task;
}

export async function listTasks(db: D1Database, owner: string, query: URLSearchParams): Promise<TaskPage> {
  const limit = z.coerce.number().int().min(1).max(100).parse(query.get('limit') ?? 50);
  const where = ['owner_id=?', 'deleted_at IS NULL'];
  const bindings: (string | number)[] = [owner];
  const rawCursor = query.get('cursor');
  if (rawCursor) {
    let cursor: { at: number; id: string };
    try { cursor = z.object({ at: z.number().int().nonnegative(), id: z.uuid() }).parse(JSON.parse(atob(rawCursor))); }
    catch { throw new Problem('invalid_cursor', 'Refresh the task list and try again.'); }
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    bindings.push(cursor.at, cursor.at, cursor.id);
  }
  const { results } = await db.prepare(`SELECT ${columns} FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...bindings, limit + 1).all<Task>();
  const items = results.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: results.length > limit && last ? btoa(JSON.stringify({ at: last.createdAt, id: last.id })) : null };
}

export async function createTask(db: D1Database, owner: string, key: string, input: z.infer<typeof createSchema>) {
  const task = {
    title: input.title, notes: input.notes ?? null, status: input.status ?? 'todo',
    estimateMinutes: input.estimateMinutes ?? null, actualMinutes: input.actualMinutes ?? null, dependsOn: input.dependsOn ?? null,
  };
  const payload = JSON.stringify(task);
  const now = Date.now();
  const result = await db.prepare(`INSERT INTO tasks
    (id, owner_id, title, notes, status, estimate_minutes, actual_minutes, depends_on, created_at, updated_at, completed_at, creation_key, creation_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, creation_key) DO NOTHING`)
    .bind(crypto.randomUUID(), owner, task.title, task.notes, task.status, task.estimateMinutes, task.actualMinutes,
      task.dependsOn, now, now, task.status === 'done' ? now : null, key, payload).run();
  const saved = await db.prepare(`SELECT ${columns}, creation_payload AS creationPayload FROM tasks WHERE owner_id=? AND creation_key=?`)
    .bind(owner, key).first<Task & { creationPayload: string }>();
  if (!saved) throw new Error('Created task could not be read.');
  if (saved.creationPayload !== payload) throw new Problem('idempotency_conflict', 'This save key was already used for a different task. Refresh before trying again.', 409);
  const { creationPayload: _, ...item } = saved;
  return { task: item, created: result.meta.changes > 0 };
}

export async function updateTask(db: D1Database, owner: string, id: string, patch: z.infer<typeof patchSchema>) {
  const before = await getTask(db, owner, id);
  const after = { ...before, ...patch };
  const completedAt = after.status === 'done' ? before.completedAt ?? Date.now() : null;
  const result = await db.prepare(`UPDATE tasks SET title=?, notes=?, status=?, estimate_minutes=?, actual_minutes=?,
    depends_on=?, completed_at=?, updated_at=?, version=version+1 WHERE owner_id=? AND id=? AND version=? AND deleted_at IS NULL`)
    .bind(after.title, after.notes, after.status, after.estimateMinutes, after.actualMinutes, after.dependsOn,
      completedAt, Date.now(), owner, id, patch.version).run();
  if (!result.meta.changes) throw new Problem('version_conflict', 'This task changed elsewhere. Refresh it before saving again.', 409);
  return getTask(db, owner, id);
}

export async function setDeleted(db: D1Database, owner: string, id: string, version: number, deleted: boolean) {
  const before = await getTask(db, owner, id, true);
  if ((before.deletedAt != null) === deleted) return before;
  const now = Date.now();
  const result = await db.prepare('UPDATE tasks SET deleted_at=?, updated_at=?, version=version+1 WHERE owner_id=? AND id=? AND version=?')
    .bind(deleted ? now : null, now, owner, id, version).run();
  if (!result.meta.changes) throw new Problem('version_conflict', 'This task changed elsewhere. Refresh it before trying again.', 409);
  return getTask(db, owner, id, true);
}
