// server/src/routes/plans.ts
import type { Context } from 'hono';
import { pool } from '../db/pg.js';
import type { JWTPayload } from '../middlewares/auth.js';

export default async function listPlansHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Number(url.searchParams.get('limit') ?? '200');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const order = url.searchParams.get('order') === 'created_at' ? 'created_at' : 'due_at';
  const dir = url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC';

  const where: string[] = ['user_id = $1'];
  const params: any[] = [auth.userId];
  let idx = 2;

  if (from) {
    where.push(`due_at >= $${idx++}`);
    params.push(new Date(from));
  }
  if (to) {
    where.push(`due_at <= $${idx++}`);
    params.push(new Date(to));
  }

  const sql = `
    SELECT
      id,
      title,
      expected_minutes AS "expectedMinutes",
      actual_minutes   AS "actualMinutes",
      due_at           AS "dueAt",
      note,
      depends_on       AS "dependsOn",
      status,
      created_at       AS "createdAt",
      project_id       AS "projectId",
      priority,
      recurrence_rule  AS "recurrenceRule"
    FROM plans
    WHERE ${where.join(' AND ')}
    ORDER BY ${order} ${dir}
    LIMIT $${idx++}
    OFFSET $${idx++}
  `;
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);

  return c.json({ items: rows });
}
