import { Context } from 'hono';
import { pool } from '../db/pg.js';
import { getMongoDb } from '../db/mongo.js';

export default async function healthHandler(c: Context) {
  const ts = new Date().toISOString();
  let pgStatus: 'up' | 'down' = 'down';
  let mongoStatus: 'up' | 'down' = 'down';

  try {
    await pool.query('SELECT 1');
    pgStatus = 'up';
  } catch (e) {
    pgStatus = 'down';
  }

  try {
    const db = await getMongoDb();
    // ping
    // @ts-ignore
    await db.command({ ping: 1 });
    mongoStatus = 'up';
  } catch (e) {
    mongoStatus = 'down';
  }

  return c.json({ ok: true, ts, db: { postgres: pgStatus, mongo: mongoStatus } });
}
