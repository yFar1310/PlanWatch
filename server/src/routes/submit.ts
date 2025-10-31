// server/src/routes/submit.ts
import { Context } from 'hono';
import { z, ZodError } from 'zod';
import { pool } from '../db/pg.js';
import { getMongoDb } from '../db/mongo.js';

const bodySchema = z.object({
  title: z.string().trim().min(3).max(200),
  expectedMinutes: z.coerce.number().int().gt(0),
  actualMinutes: z.coerce.number().int().min(0).optional(),
  // accepte string/Date, normalise en ISO (UTC) et vérifie la validité
  dueAt: z.union([z.string(), z.date()]).transform((v) => {
    const d = typeof v === 'string' ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
    // on stocke en ISO UTC
    return new Date(Date.UTC(
      d.getFullYear(), d.getMonth(), d.getDate(),
      d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
    )).toISOString();
  }),
  note: z.string().trim().max(500).optional(),
});

export default async function submitHandler(c: Context) {
  let client: import('pg').PoolClient | null = null;
  try {
    if (c.req.header('content-type')?.includes('application/json') !== true) {
      return c.json({ ok: false, error: 'unsupported_media_type' }, 415);
    }

    const json = await c.req.json();
    const parsed = bodySchema.parse(json);

    client = await pool.connect();
    await client.query('BEGIN');

    const q = `
      INSERT INTO plans (title, expected_minutes, actual_minutes, due_at, note)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, expected_minutes, actual_minutes, due_at, note, created_at
    `;
    const values = [
      parsed.title,
      parsed.expectedMinutes,
      parsed.actualMinutes ?? null,
      parsed.dueAt,           // déjà ISO UTC
      parsed.note ?? null,
    ];

    const { rows } = await client.query(q, values);
    const plan = rows[0];

    const db = await getMongoDb();
    await db.collection('events').insertOne({
      type: 'plan_submitted',
      at: new Date(),
      planId: plan.id,
      payload: parsed,
    });

    await client.query('COMMIT');
    return c.json({ ok: true, plan }, 201);
  } catch (err: any) {
    try { if (client) await client.query('ROLLBACK'); } catch {}
    if (err instanceof ZodError) {
      return c.json({ ok: false, error: 'validation', issues: err.errors }, 400);
    }
    console.error('submit error', err);
    return c.json({ ok: false, error: 'internal' }, 500);
  } finally {
    try { if (client) client.release(); } catch {}
  }
}
