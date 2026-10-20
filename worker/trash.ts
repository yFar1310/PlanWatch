import { z } from 'zod';
import { Problem } from './tasks';
import type { TrashSummary } from '../shared/tasks';
const entry = z.object({ id: z.uuid(), version: z.number().int().positive() }).strict();
export const purgeSchema = z.object({ items: z.array(entry).min(1).max(100).refine(items => new Set(items.map(item=>item.id)).size===items.length,'Select each task only once.'), confirmed: z.literal(true) }).strict();
export const emptySchema = z.object({ cutoff: z.number().int().nonnegative().safe(), confirmed: z.literal(true) }).strict();
export async function trashSummary(db: D1Database, owner: string): Promise<TrashSummary> {
  return (await db.prepare(`SELECT (SELECT count(*) FROM tasks WHERE owner_id=? AND deleted_at IS NOT NULL) AS count,
    COALESCE(max(id),0) AS cutoff FROM task_events WHERE owner_id=?`).bind(owner,owner).first<TrashSummary>())!;
}
export async function purgeTasks(db: D1Database, owner: string, input: z.infer<typeof purgeSchema>) {
  const json=JSON.stringify(input.items);
  // Eligibility and versions are tested by the DELETE itself, so a concurrent restore cannot be erased.
  const result=await db.prepare(`DELETE FROM tasks WHERE owner_id=? AND deleted_at IS NOT NULL
    AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?))
    AND (SELECT count(*) FROM tasks t JOIN json_each(?) j ON t.id=json_extract(j.value,'$.id')
      WHERE t.owner_id=? AND t.deleted_at IS NOT NULL AND t.version=json_extract(j.value,'$.version'))=json_array_length(?) RETURNING id`)
    .bind(owner,json,json,owner,json).all<{id:string}>();
  if(result.results.length!==input.items.length) throw new Problem('trash_changed','The selection changed elsewhere. Nothing was deleted. Refresh the Trash and select again.',409);
  return { deleted:result.results.length, ids:result.results.map(row=>row.id) };
}
export async function emptyTrash(db: D1Database, owner: string, cutoff: number) {
  const result=await db.prepare(`DELETE FROM tasks WHERE owner_id=? AND deleted_at IS NOT NULL
    AND (SELECT COALESCE(max(id),0) FROM task_events WHERE owner_id=tasks.owner_id AND task_id=tasks.id)<=? RETURNING id`)
    .bind(owner,cutoff).all<{id:string}>();
  return { deleted:result.results.length, ids:result.results.map(row=>row.id) };
}
