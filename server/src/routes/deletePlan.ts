import type { Context } from 'hono'
import { pool } from '../db/pg.js'

export default async function deletePlanHandler(c: Context) {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok:false, error:'bad_id' }, 400)
  const { rowCount } = await pool.query('DELETE FROM plans WHERE id = $1', [id])
  if (!rowCount) return c.json({ ok:false, error:'not_found' }, 404)
  return c.json({ ok:true })
}
