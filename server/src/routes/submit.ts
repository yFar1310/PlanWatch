// server/src/routes/submit.ts
import { Context } from 'hono';
import { z, ZodError } from 'zod';
import { pool } from '../db/pg.js';
import { getMongoDb } from '../db/mongo.js';

const bodySchema = z.object({
  title: z.string().trim().min(3).max(200),
  expectedMinutes: z.coerce.number().int().gt(0),

  // peut être undefined ou null
  actualMinutes: z.coerce.number().int().min(0).nullable().optional(),

  // on accepte juste une string, on valide nous-mêmes ensuite
  dueAt: z.string(),

  note: z.string().trim().max(500).nullable().optional(),

  //  gère null / undefined comme dans updatePlan
  dependsOn: z
    .preprocess((val) => {
      if (val === null || val === undefined) return null
      if (Array.isArray(val)) {
        if (!val.length) return null
        return val[0]
      }
      return val
    }, z.coerce.number().int().positive().nullable())
    .optional(),

  status: z.enum(['not_started', 'in_progress', 'done']).optional(),
})

export default async function submitHandler(c: Context) {
  let client: import('pg').PoolClient | null = null

  try {
    if (!c.req.header('content-type')?.includes('application/json')) {
      return c.json({ ok: false, error: 'unsupported_media_type' }, 415)
    }

    const json = await c.req.json()
    const parsed = bodySchema.parse(json)

    // ✅ dueAt -> Date ISO, avec message clair si invalide
    const d = new Date(parsed.dueAt)
    if (Number.isNaN(d.getTime())) {
      return c.json(
        { ok: false, error: 'invalid_due_at', message: 'Invalid dueAt datetime' },
        400
      )
    }
    const dueAtIso = d.toISOString()

    // 🔥 auto-status
    const effectiveStatus =
      parsed.status ??
      (parsed.actualMinutes != null && parsed.actualMinutes > 0 ? 'done' : 'not_started')

    const effectiveDependsOn =
      parsed.dependsOn === undefined ? null : parsed.dependsOn

    // 🔍 check dependency date logic
    if (effectiveDependsOn != null) {
      const { rows: depRows } = await pool.query(
        'SELECT id, title, due_at FROM plans WHERE id = $1',
        [effectiveDependsOn]
      )

      if (!depRows.length) {
        return c.json(
          { ok: false, error: 'dependency_not_found', dependencyId: effectiveDependsOn },
          400
        )
      }

      const dep = depRows[0]
      const depDue = new Date(dep.due_at)
      const thisDue = new Date(dueAtIso)

      if (thisDue < depDue) {
        return c.json(
          {
            ok: false,
            error: 'invalid_dependency_due_at',
            message: `Due date must be after or equal to dependency "${dep.title}".`,
            dependencyDueAt: depDue.toISOString(),
          },
          400
        )
      }
    }

    client = await pool.connect()
    await client.query('BEGIN')

    const q = `
      INSERT INTO plans (title, expected_minutes, actual_minutes, due_at, note, depends_on, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        title,
        expected_minutes AS "expectedMinutes",
        actual_minutes   AS "actualMinutes",
        due_at           AS "dueAt",
        note,
        depends_on       AS "dependsOn",
        status,
        created_at       AS "createdAt"
    `
    const values = [
      parsed.title,
      parsed.expectedMinutes,
      parsed.actualMinutes ?? null,
      dueAtIso,
      parsed.note ?? null,
      effectiveDependsOn,
      effectiveStatus,
    ]

    const { rows } = await client.query(q, values)
    const plan = rows[0]

    const db = await getMongoDb()

    await db.collection('events').insertOne({
      type: 'plan_submitted',
      at: new Date(),
      planId: plan.id,
      dependsOn: effectiveDependsOn,
      payload: { ...parsed, dueAt: dueAtIso, status: effectiveStatus },
    })

    await db.collection('plans').updateOne(
      { pgId: plan.id },
      {
        $set: {
          title: plan.title,
          expectedMinutes: plan.expectedMinutes,
          actualMinutes: plan.actualMinutes,
          dueAt: plan.dueAt,
          note: plan.note,
          dependsOn: plan.dependsOn ?? null,
          status: plan.status,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    )

    await client.query('COMMIT')
    return c.json({ ok: true, plan }, 201)
  } catch (err: any) {
    try { if (client) await client.query('ROLLBACK') } catch {}
    if (err instanceof ZodError) {
      return c.json({ ok: false, error: 'validation', issues: err.errors }, 400)
    }
    console.error('submit error', err)
    return c.json({ ok: false, error: 'internal' }, 500)
  } finally {
    try { if (client) client.release() } catch {}
  }
}

