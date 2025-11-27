// server/src/routes/submit.ts
import { Context } from 'hono';
import { z, ZodError } from 'zod';
import { pool } from '../db/pg.js';
import { getMongoDb } from '../db/mongo.js';

const bodySchema = z.object({
  title: z.string().trim().min(3).max(200),
  expectedMinutes: z.coerce.number().int().gt(0),
  actualMinutes: z.coerce.number().int().min(0).optional(),
  dueAt: z.union([z.string(), z.date()]).transform((v) => {
    const d = typeof v === 'string' ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
    return new Date(Date.UTC(
      d.getFullYear(), d.getMonth(), d.getDate(),
      d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
    )).toISOString();
  }),
  note: z.string().trim().max(500).optional(),
  dependsOn: z.coerce.number().int().positive().optional(),
});

export default async function submitHandler(c: Context) {
  let client: import('pg').PoolClient | null = null;
  try {
    if (c.req.header('content-type')?.includes('application/json') !== true) {
      return c.json({ ok: false, error: 'unsupported_media_type' }, 415);
    }

    const json = await c.req.json();
    const parsed = bodySchema.parse(json);

    if (parsed.dependsOn) {
      const { rows: depRows } = await pool.query(
        'SELECT id, title, due_at FROM plans WHERE id = $1',
        [parsed.dependsOn]
      );
    
      if (!depRows.length) {
        return c.json(
          { ok: false, error: 'dependency_not_found', dependencyId: parsed.dependsOn },
          400
        );
      }
    
      const dep = depRows[0];
      const depDue = new Date(dep.due_at);
      const thisDue = new Date(parsed.dueAt);
    
      if (thisDue < depDue) {
        return c.json(
          {
            ok: false,
            error: 'invalid_dependency_due_at',
            message: `Due date must be after or equal to dependency "${dep.title}".`,
            dependencyDueAt: depDue.toISOString(),
          },
          400
        );
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const q = `
    INSERT INTO plans (title, expected_minutes, actual_minutes, due_at, note, depends_on)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, title, expected_minutes, actual_minutes, due_at, note, depends_on, created_at
  `;
  const values = [
    parsed.title,
    parsed.expectedMinutes,
    parsed.actualMinutes ?? null,
    parsed.dueAt,           // déjà ISO UTC
    parsed.note ?? null,
    parsed.dependsOn ?? null, 
  ];

    const { rows } = await client.query(q, values);
    const plan = rows[0];

    const db = await getMongoDb();
    await db.collection('events').insertOne({
      type: 'plan_submitted',
      at: new Date(),
      planId: plan.id,
      dependsOn: parsed.dependsOn ?? null,
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
