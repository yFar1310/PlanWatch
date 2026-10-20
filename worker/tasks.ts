import { z } from 'zod';
import type { Task, TaskPage, TimelinePage, TrashSummary } from '../shared/tasks';
import { scheduleProblem, dayNumber } from '../shared/scheduling';
import { isCalendarDay } from '../shared/calendar';

export class Problem extends Error {
  constructor(public code: string, message: string, public status: 400 | 404 | 409 | 410 | 415 = 400) { super(message); }
}

const calendarDay = z.string().refine(isCalendarDay, 'Choose a valid calendar date.');
const taskFields = z.object({
  title: z.string().trim().min(1, 'Give the task a title.').max(200),
  notes: z.string().trim().max(5000).nullable(),
  status: z.enum(['todo', 'doing', 'done']),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  estimateMinutes: z.number().int().positive().nullable(),
  actualMinutes: z.number().int().nonnegative().nullable(),
  dependsOn: z.uuid().nullable(),
  plannedDate: calendarDay.nullable(),
  plannedEndDate: calendarDay.nullable(),
  startTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Choose a valid time.').nullable(),
  endTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Choose a valid time.').nullable(),
});

export const createSchema = taskFields.partial().required({ title: true }).strict();
export const patchSchema = taskFields.partial().extend({ version: z.number().int().positive() }).strict().refine(
  (value) => Object.keys(value).some((key) => key !== 'version'), 'Change at least one task field.',
);
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
export const idSchema = z.uuid();

const columns = `id, title, notes, status, priority,
  (SELECT title FROM tasks dependency WHERE dependency.id=tasks.depends_on AND dependency.owner_id=tasks.owner_id AND dependency.deleted_at IS NULL) AS dependencyTitle,
  (SELECT status FROM tasks dependency WHERE dependency.id=tasks.depends_on AND dependency.owner_id=tasks.owner_id AND dependency.deleted_at IS NULL) AS dependencyStatus, estimate_minutes AS estimateMinutes,
  actual_minutes AS actualMinutes, depends_on AS dependsOn, created_at AS createdAt,
  updated_at AS updatedAt, completed_at AS completedAt, deleted_at AS deletedAt, planned_date AS plannedDate, planned_end_date AS plannedEndDate, start_time AS startTime, end_time AS endTime, version`;

export async function getTask(db: D1Database, owner: string, id: string, includeDeleted = false) {
  const task = await db.prepare(`SELECT ${columns} FROM tasks WHERE owner_id=? AND id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`)
    .bind(owner, id).first<Task>();
  if (!task) throw new Problem('not_found', 'This task is no longer available.', 404);
  return task;
}

export async function listTasks(db: D1Database, owner: string, query: URLSearchParams): Promise<TaskPage> {
  const limit = z.coerce.number().int().min(1).max(100).parse(query.get('limit') ?? 50);
  const view = z.enum(['tasks', 'today', 'trash']).parse(query.get('view') ?? 'tasks');
  const status = z.enum(['open', 'done', 'all']).parse(query.get('status') ?? 'all');
  const search = z.string().trim().max(200).parse(query.get('q') ?? '');
  const day = view === 'today' ? calendarDay.parse(query.get('day')) : '';
  const priority = z.enum(['all', 'urgent', 'high', 'medium', 'low']).parse(query.get('priority') ?? 'all');
  const scope = JSON.stringify([owner, view, status, search, day, priority]);
  const sortColumn = view === 'trash' ? 'deleted_at' : 'created_at';
  const where = ['owner_id=?', view === 'trash' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const bindings: (string | number)[] = [owner];
  if (priority !== 'all') { where.push('priority=?'); bindings.push(priority); }
  if (view === 'today') {
    where.push("status <> 'done'", 'planned_date <= ?');
    bindings.push(day);
  }
  if (status !== 'all') where.push(status === 'open' ? "status <> 'done'" : "status = 'done'");
  if (search) {
    // Literal search: %, _ and quotes are text, not SQL wildcards or SQL code.
    where.push("instr(lower(title || ' ' || coalesce(notes, '')), lower(?)) > 0");
    bindings.push(search);
  }
  const rawCursor = query.get('cursor');
  if (rawCursor) {
    let cursor: { at: number; id: string; scope: string };
    try { cursor = z.object({ at: z.number().int().nonnegative(), id: z.uuid(), scope: z.literal(scope) }).parse(JSON.parse(decodeURIComponent(atob(rawCursor)))); }
    catch { throw new Problem('invalid_cursor', 'Refresh the task list and try again.'); }
    where.push(`(${sortColumn} < ? OR (${sortColumn} = ? AND id < ?))`);
    bindings.push(cursor.at, cursor.at, cursor.id);
  }
  const { results } = await db.prepare(`SELECT ${columns} FROM tasks WHERE ${where.join(' AND ')} ORDER BY ${sortColumn} DESC, id DESC LIMIT ?`)
    .bind(...bindings, limit + 1).all<Task>();
  const items = results.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: results.length > limit && last ? btoa(encodeURIComponent(JSON.stringify({ at: view === 'trash' ? last.deletedAt : last.createdAt, id: last.id, scope }))) : null };
}

export async function createTask(db: D1Database, owner: string, key: string, input: z.infer<typeof createSchema>) {
  const task = {
    title: input.title, notes: input.notes ?? null, status: input.status ?? 'todo', priority: input.priority ?? 'medium',
    estimateMinutes: input.estimateMinutes ?? null, actualMinutes: input.actualMinutes ?? null, dependsOn: input.dependsOn ?? null,
    plannedDate: input.plannedDate ?? null, plannedEndDate: input.plannedEndDate ?? null, startTime: input.startTime ?? null, endTime: input.endTime ?? null,
  };
  const invalid = scheduleProblem(task); if (invalid) throw new Problem('invalid_schedule', invalid);
  const payload = JSON.stringify(task);
  const now = Date.now();
  const result = await db.prepare(`INSERT INTO tasks
    (id, owner_id, title, notes, status, estimate_minutes, actual_minutes, depends_on, planned_date, planned_end_date, start_time, end_time, priority, created_at, updated_at, completed_at, creation_key, creation_payload)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE owner_id=? AND creation_key=?)
    AND NOT EXISTS (SELECT 1 FROM purged_tasks WHERE owner_id=? AND creation_key=?)
    ON CONFLICT(owner_id, creation_key) DO NOTHING`)
    .bind(crypto.randomUUID(), owner, task.title, task.notes, task.status, task.estimateMinutes, task.actualMinutes,
      task.dependsOn, task.plannedDate, task.plannedEndDate, task.startTime, task.endTime, task.priority, now, now, task.status === 'done' ? now : null, key, payload, owner, key, owner, key).run();
  const saved = await db.prepare(`SELECT ${columns}, creation_payload AS creationPayload FROM tasks WHERE owner_id=? AND creation_key=?`)
    .bind(owner, key).first<Task & { creationPayload: string }>();
  if (!saved) {
    if (await db.prepare('SELECT 1 FROM purged_tasks WHERE owner_id=? AND creation_key=?').bind(owner,key).first()) throw new Problem('task_permanently_deleted', 'This task was permanently deleted. Start a new task instead of retrying the old save.', 410);
    throw new Error('Created task could not be read.');
  }
  const original = JSON.parse(saved.creationPayload) as Partial<typeof task>;
  if ((Object.keys(task) as (keyof typeof task)[]).some(field => (original[field] ?? (field === 'priority' ? 'medium' : null)) !== task[field])) {
    throw new Problem('idempotency_conflict', 'This save key was already used for a different task. Refresh before trying again.', 409);
  }
  const { creationPayload: _, ...item } = saved;
  return { task: item, created: result.meta.changes > 0 };
}

export async function updateTask(db: D1Database, owner: string, id: string, patch: z.infer<typeof patchSchema>) {
  const before = await getTask(db, owner, id);
  const after = { ...before, ...patch };
  const invalid = scheduleProblem(after); if (invalid) throw new Problem('invalid_schedule', invalid);
  const completedAt = after.status === 'done' ? before.completedAt ?? Date.now() : null;
  const result = await db.prepare(`UPDATE tasks SET title=?, notes=?, status=?, estimate_minutes=?, actual_minutes=?,
    depends_on=?, planned_date=?, planned_end_date=?, start_time=?, end_time=?, priority=?, completed_at=?, updated_at=?, version=version+1 WHERE owner_id=? AND id=? AND version=? AND deleted_at IS NULL`)
    .bind(after.title, after.notes, after.status, after.estimateMinutes, after.actualMinutes, after.dependsOn,
      after.plannedDate, after.plannedEndDate, after.startTime, after.endTime, after.priority, completedAt, Date.now(), owner, id, patch.version).run();
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

export async function listTimeline(db: D1Database, owner: string, query: URLSearchParams): Promise<TimelinePage> {
  const from=calendarDay.parse(query.get('from')), to=calendarDay.parse(query.get('to'));
  if(dayNumber(to)-dayNumber(from)<0 || dayNumber(to)-dayNumber(from)>41) throw new Problem('invalid_range','Choose a range of up to 42 days.');
  const priority=z.enum(['all','urgent','high','medium','low']).parse(query.get('priority')??'all');
  const status=z.enum(['all','open','done']).parse(query.get('status')??'all');
  const search=z.string().trim().max(200).parse(query.get('q')??'');
  const scope=JSON.stringify([owner,from,to,priority,status,search]);
  const filters=['owner_id=?','deleted_at IS NULL']; const args:(string|number)[]=[owner];
  if(priority!=='all'){ filters.push('priority=?');args.push(priority); }
  if(status!=='all') filters.push(status==='open'?"status<>'done'":"status='done'");
  if(search){filters.push("instr(lower(title || ' ' || COALESCE(notes,'')),lower(?))>0");args.push(search);}
  const unscheduled=db.prepare(`SELECT count(*) AS count FROM tasks WHERE ${filters.join(' AND ')} AND planned_date IS NULL`).bind(...args);
  filters.push('planned_date<=?','COALESCE(planned_end_date,planned_date)>=?');args.push(to,from);
  if(query.has('cursor')) {
    try {
      const cursor=z.object({day:calendarDay,id:z.uuid(),scope:z.literal(scope)}).parse(JSON.parse(decodeURIComponent(atob(query.get('cursor')!))));
      filters.push('(planned_date>? OR (planned_date=? AND id>?))');args.push(cursor.day,cursor.day,cursor.id);
    } catch { throw new Problem('invalid_cursor','Refresh the timeline and try again.'); }
  }
  const results=await db.batch([db.prepare(`SELECT ${columns} FROM tasks WHERE ${filters.join(' AND ')} ORDER BY planned_date,id LIMIT 101`).bind(...args),unscheduled]);
  const rows=results[0].results as unknown as Task[], items=rows.slice(0,100), last=items.at(-1);
  return {items,unscheduledCount:Number((results[1].results[0] as {count:number}|undefined)?.count??0),nextCursor:rows.length>100&&last?btoa(encodeURIComponent(JSON.stringify({day:last.plannedDate,id:last.id,scope}))):null};
}
