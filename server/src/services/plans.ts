import { pool } from '../db/pg.js';
import { queueTaskEvent } from '../db/outbox.js';
import { createPlanSchema, updatePlanSchema, PlanError, validateDependencies, type PlanRow } from '../domain/plans.js';
import type { z } from 'zod';
import type { PoolClient } from 'pg';

const columns = `id, user_id AS "userId", title, expected_minutes AS "expectedMinutes",
  actual_minutes AS "actualMinutes", due_at AS "dueAt", note, depends_on AS "dependsOn",
  status, created_at AS "createdAt", project_id AS "projectId", priority, recurrence_rule AS "recurrenceRule"`;

async function transaction<T>(userId: number, action: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(127936, $1)', [userId]);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function graphFor(client: PoolClient, userId: number) {
  return (await client.query<PlanRow>(`SELECT ${columns} FROM plans WHERE user_id = $1`, [userId])).rows;
}

export async function createPlan(userId: number, input: z.infer<typeof createPlanSchema>) {
  return transaction(userId, async (client) => {
    validateDependencies({ id: -1, dependsOn: input.dependsOn ?? null, dueAt: input.dueAt }, await graphFor(client, userId));
    const { rows } = await client.query<PlanRow>(`
      INSERT INTO plans (user_id, title, expected_minutes, actual_minutes, due_at, note, depends_on, status, project_id, priority, recurrence_rule)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${columns}
    `, [userId, input.title, input.expectedMinutes, input.actualMinutes ?? null, input.dueAt,
      input.note ?? null, input.dependsOn ?? null, input.status ?? 'not_started', input.projectId ?? null,
      input.priority ?? 0, input.recurrenceRule ?? null]);
    await queueTaskEvent(client, 'plan_submitted', rows[0]);
    return rows[0];
  });
}

export async function updatePlan(userId: number, id: number, patch: z.infer<typeof updatePlanSchema>) {
  return transaction(userId, async (client) => {
    const graph = await graphFor(client, userId);
    const before = graph.find((task) => task.id === id);
    if (!before) throw new PlanError('not_found', 'This task is no longer available.', 404);
    const after = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) } as PlanRow;
    validateDependencies(after, graph);
    const { rows } = await client.query<PlanRow>(`
      UPDATE plans SET title=$1, expected_minutes=$2, actual_minutes=$3, due_at=$4, note=$5,
        depends_on=$6, status=$7, project_id=$8, priority=$9, recurrence_rule=$10
      WHERE id=$11 AND user_id=$12 RETURNING ${columns}
    `, [after.title, after.expectedMinutes, after.actualMinutes, after.dueAt, after.note, after.dependsOn,
      after.status, after.projectId, after.priority, after.recurrenceRule, id, userId]);
    await queueTaskEvent(client, 'plan_updated', rows[0], before);
    return rows[0];
  });
}

export async function deletePlan(userId: number, id: number) {
  return transaction(userId, async (client) => {
    const { rows } = await client.query<PlanRow>(`DELETE FROM plans WHERE id=$1 AND user_id=$2 RETURNING ${columns}`, [id, userId]);
    // A retried deletion succeeds even if the first successful response was lost.
    if (rows[0]) await queueTaskEvent(client, 'plan_deleted', rows[0], rows[0]);
  });
}
