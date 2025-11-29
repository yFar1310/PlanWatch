// server/src/routes/getPlan.ts
import type { Context } from 'hono';
import { pool } from '../db/pg.js';
import type { JWTPayload } from '../middlewares/auth.js';

export default async function getPlanHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) {
    return c.json({ error: 'invalid_id' }, 400);
  }

  const { rows } = await pool.query(
    `
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
      WHERE id = $1 AND user_id = $2
    `,
    [id, auth.userId],
  );

  if (!rows.length) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ plan: rows[0] });
}
