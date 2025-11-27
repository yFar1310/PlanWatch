import type { Context } from 'hono';
import { z } from 'zod';
import { pool } from '../db/pg.js';

const qSchema = z.object({
  // filtres/pagination optionnels
  from: z.string().datetime().optional(),      // ISO
  to: z.string().datetime().optional(),        // ISO
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  order: z.enum(['due_at', 'created_at']).default('due_at'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export default async function listPlansHandler(c: Context) {
  const qp = qSchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));

  const where: string[] = [];
  const vals: any[] = [];
  let i = 1;

  if (qp.from) { where.push(`due_at >= $${i++}`); vals.push(new Date(qp.from).toISOString()); }
  if (qp.to)   { where.push(`due_at <  $${i++}`); vals.push(new Date(qp.to).toISOString()); }

  const sql = `
    SELECT
      id,
      title,
      expected_minutes   AS "expectedMinutes",
      actual_minutes     AS "actualMinutes",
      due_at             AS "dueAt",
      note,
      depends_on         AS "dependsOn",
      created_at         AS "createdAt"
    FROM plans
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${qp.order} ${qp.dir}
    LIMIT $${i++} OFFSET $${i++}
  `;

  vals.push(qp.limit, qp.offset);

  const { rows } = await pool.query(sql, vals);
  return c.json(rows);
}
