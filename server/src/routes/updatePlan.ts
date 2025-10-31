import type { Context } from 'hono'
import { z, ZodError } from 'zod'
import { pool } from '../db/pg.js'

const patchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  expectedMinutes: z.coerce.number().int().gt(0).optional(),
  actualMinutes: z.coerce.number().int().min(0).nullable().optional(),
  dueAt: z.union([z.string(), z.date()]).transform((v) => {
    if (v === undefined) return undefined
    const d = typeof v === 'string' ? new Date(v) : v
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date')
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())).toISOString()
  }).optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export default async function updatePlanHandler(c: Context) {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ ok:false, error:'bad_id' }, 400)
  try {
    const body = await c.req.json()
    const p = patchSchema.parse(body)
    const fields: string[] = []
    const vals: any[] = []
    let i = 1
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue
      const col = ({
        title:'title',
        expectedMinutes:'expected_minutes',
        actualMinutes:'actual_minutes',
        dueAt:'due_at',
        note:'note',
      } as any)[k]
      fields.push(`${col} = $${i++}`)
      vals.push(v)
    }
    if (!fields.length) return c.json({ ok:false, error:'empty_patch' }, 400)
    vals.push(id)
    const { rows } = await pool.query(
      `UPDATE plans SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, title,
        expected_minutes AS "expectedMinutes", actual_minutes AS "actualMinutes",
        due_at AS "dueAt", note, created_at AS "createdAt"`,
      vals
    )
    if (!rows.length) return c.json({ ok:false, error:'not_found' }, 404)
    return c.json({ ok:true, plan: rows[0] })
  } catch (e:any) {
    if (e instanceof ZodError) return c.json({ ok:false, error:'validation', issues:e.errors }, 400)
    return c.json({ ok:false, error:'internal' }, 500)
  }
}
