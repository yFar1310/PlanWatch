// server/src/routes/update-plan.ts
import type { Context } from 'hono'
import { z, ZodError } from 'zod'
import { pool } from '../db/pg.js'
import { getMongoDb } from '../db/mongo.js'

const patchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  expectedMinutes: z.coerce.number().int().gt(0).optional(),
  actualMinutes: z.coerce.number().int().min(0).nullable().optional(),

  // on accepte une string ISO, ou rien
  dueAt: z.string().optional(),

  note: z.string().trim().max(500).nullable().optional(),

  // 🔧 corrige ici
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

export default async function updatePlanHandler(c: Context) {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ ok: false, error: 'bad_id' }, 400)
  }

  try {
    const body = await c.req.json()
    const raw = patchSchema.parse(body)

    const patch: typeof raw & { dueAt?: string } = { ...raw }

    if (patch.dueAt !== undefined) {
      const d = new Date(patch.dueAt)
      if (Number.isNaN(d.getTime())) {
        return c.json(
          { ok: false, error: 'invalid_due_at', message: 'Invalid dueAt datetime' },
          400
        )
      }

      // on garde simplement l'instant tel quel, en ISO
      patch.dueAt = d.toISOString()
    }

    // état actuel
    const currentRes = await pool.query(
      'SELECT id, due_at, depends_on, status FROM plans WHERE id = $1',
      [id]
    )
    if (!currentRes.rows.length) {
      return c.json({ ok: false, error: 'not_found' }, 404)
    }
    const current = currentRes.rows[0]

    // valeurs effectives après patch
    const effectiveDueAtIso: string =
      patch.dueAt ??
      (current.due_at instanceof Date
        ? current.due_at.toISOString()
        : String(current.due_at))

    const effectiveDependsOn: number | null =
      patch.dependsOn !== undefined ? patch.dependsOn : current.depends_on

    // règle dépendance
    if (effectiveDependsOn != null) {
      if (effectiveDependsOn === id) {
        return c.json(
          {
            ok: false,
            error: 'self_dependency',
            message: 'A plan cannot depend on itself.',
          },
          400
        )
      }

      const depRes = await pool.query(
        'SELECT id, title, due_at FROM plans WHERE id = $1',
        [effectiveDependsOn]
      )
      if (!depRes.rows.length) {
        return c.json(
          {
            ok: false,
            error: 'dependency_not_found',
            dependencyId: effectiveDependsOn,
          },
          400
        )
      }

      const dep = depRes.rows[0]
      const depDue = new Date(dep.due_at)
      const thisDue = new Date(effectiveDueAtIso)

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

    // auto-status si actualMinutes > 0
    const patchWithStatus: any = { ...patch }
    if (patch.actualMinutes != null && patch.actualMinutes > 0 && !patch.status) {
      patchWithStatus.status = 'done'
    }

    // UPDATE dynamique
    const fields: string[] = []
    const vals: any[] = []
    let i = 1

    for (const [k, v] of Object.entries(patchWithStatus)) {
      if (v === undefined) continue

      const col = (
        {
          title: 'title',
          expectedMinutes: 'expected_minutes',
          actualMinutes: 'actual_minutes',
          dueAt: 'due_at',
          note: 'note',
          dependsOn: 'depends_on',
          status: 'status',
        } as Record<string, string>
      )[k]

      if (!col) continue // sécurité : au cas où

      fields.push(`${col} = $${i++}`)
      vals.push(v)
    }

    if (!fields.length) {
      return c.json({ ok: false, error: 'empty_patch' }, 400)
    }

    vals.push(id)

    const { rows } = await pool.query(
      `UPDATE plans
       SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING
         id,
         title,
         expected_minutes AS "expectedMinutes",
         actual_minutes   AS "actualMinutes",
         due_at           AS "dueAt",
         note,
         depends_on       AS "dependsOn",
         status,
         created_at       AS "createdAt"`,
      vals
    )

    if (!rows.length) {
      return c.json({ ok: false, error: 'not_found' }, 404)
    }

    const planRow = rows[0]

    // Mongo "plans"
    const db = await getMongoDb()
    await db.collection('plans').updateOne(
      { pgId: planRow.id },
      {
        $set: {
          title: planRow.title,
          expectedMinutes: planRow.expectedMinutes,
          actualMinutes: planRow.actualMinutes,
          dueAt: planRow.dueAt,
          note: planRow.note,
          dependsOn: planRow.dependsOn ?? null,
          status: planRow.status,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    )

    // Mongo event
    await db.collection('events').insertOne({
      type: 'plan_updated',
      at: new Date(),
      planId: planRow.id,
      patch: patchWithStatus,
    })

    return c.json({ ok: true, plan: planRow })
  } catch (e: any) {
    // 🔍 beaucoup plus verbeux pour débug éventuel
    console.error('updatePlan error', e)
    if (e instanceof ZodError) {
      return c.json({ ok: false, error: 'validation', issues: e.errors }, 400)
    }
    return c.json(
      {
        ok: false,
        error: 'internal',
        message: e?.message ?? 'internal_error',
      },
      500
    )
  }
}
