// server/src/routes/deletePlan.ts
import type { Context } from 'hono'
import { pool } from '../db/pg.js'
import { getMongoDb } from '../db/mongo.js'

export default async function deletePlanHandler(c: Context) {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: 'bad_id' }, 400)
  }

  try {
    // 1) Postgres : enlever la dépendance (INT, plus INT[])
    await pool.query(
      `
      UPDATE plans
      SET depends_on = NULL
      WHERE depends_on = $1
      `,
      [id],
    )

    // puis supprimer le plan lui-même
    const { rowCount } = await pool.query(
      'DELETE FROM plans WHERE id = $1',
      [id],
    )
    if (!rowCount) {
      return c.json({ ok: false, error: 'not_found' }, 404)
    }

    // 2) Mongo : sync vue "plans"
    const db = await getMongoDb()

    await db.collection('plans').updateMany(
      { dependsOn: id },
      { $set: { dependsOn: null, updatedAt: new Date() } },
    )

    await db.collection('plans').deleteOne({ pgId: id })

    await db.collection('events').insertOne({
      type: 'plan_deleted',
      at: new Date(),
      planId: id,
    })

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('deletePlan error', e)
    return c.json(
      { ok: false, error: 'server_error', message: e.message },
      500,
    )
  }
}
