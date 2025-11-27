import type { Context } from 'hono'
import { pool } from '../db/pg.js'
import { getMongoDb } from '../db/mongo.js'

export default async function deletePlanHandler(c: Context) {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: 'bad_id' }, 400)
  }

  // 1) Postgres : enlever dépendances + supprimer le plan
  await pool.query('UPDATE plans SET depends_on = NULL WHERE depends_on = $1', [id])
  const { rowCount } = await pool.query('DELETE FROM plans WHERE id = $1', [id])
  if (!rowCount) {
    return c.json({ ok: false, error: 'not_found' }, 404)
  }

  // 2) Mongo : sync de la vue "plans"
  const db = await getMongoDb()

  // enlever les dépendances vers ce plan
  await db.collection('plans').updateMany(
    { dependsOn: id },
    { $set: { dependsOn: null, updatedAt: new Date() } }
  )

  // supprimer le plan lui-même
  await db.collection('plans').deleteOne({ pgId: id })

  // 3) Event log
  await db.collection('events').insertOne({
    type: 'plan_deleted',
    at: new Date(),
    planId: id,
  })

  return c.json({ ok: true })
}
