import type { Context } from 'hono'
import { pool } from '../db/pg.js'

export default async function getPlanHandler(c: Context) {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok:false, error:'bad_id' }, 400)
  const { rows } = await pool.query(`
    SELECT id, title,
      expected_minutes AS "expectedMinutes",
      actual_minutes   AS "actualMinutes",
      due_at           AS "dueAt",
      note, created_at AS "createdAt"
    FROM plans WHERE id = $1
  `, [id])
  if (!rows.length) return c.json({ ok:false, error:'not_found' }, 404)
  return c.json(rows[0])
}
