// server/src/routes/deletePlan.ts
import type { Context } from 'hono';
import { pool } from '../db/pg.js';
import { getMongoDb } from '../db/mongo.js';
import type { JWTPayload } from '../middlewares/auth.js';

export default async function deletePlanHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid_id' }, 400);

  const { rows } = await pool.query(
    'DELETE FROM plans WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, auth.userId],
  );

  if (!rows.length) {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }

  const db = await getMongoDb();
  await db.collection('events').insertOne({
    type: 'plan_deleted',
    at: new Date(),
    userId: auth.userId,
    planId: id,
  });

  await db.collection('plans').deleteOne({ pgId: id, userId: auth.userId });

  return c.json({ ok: true });
}
