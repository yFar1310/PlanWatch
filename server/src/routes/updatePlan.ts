// server/src/routes/updatePlan.ts
import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { pool } from '../db/pg.js';
import { getMongoDb } from '../db/mongo.js';
import type { JWTPayload } from '../middlewares/auth.js';

const bodySchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  expectedMinutes: z.coerce.number().int().gt(0).optional(),
  actualMinutes: z.coerce.number().int().min(0).nullable().optional(),
  dueAt: z.string().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  dependsOn: z
    .preprocess((val) => {
      if (val === null || val === undefined) return null;
      if (Array.isArray(val)) {
        if (!val.length) return null;
        return val[0];
      }
      return val;
    }, z.coerce.number().int().positive().nullable())
    .optional(),
  status: z.enum(['not_started', 'in_progress', 'done']).optional(),
  projectId: z.coerce.number().int().positive().nullable().optional(),
  priority: z.coerce.number().int().min(-5).max(5).optional(),
  recurrenceRule: z.string().trim().max(500).nullable().optional(),
});

export default async function updatePlanHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) return c.json({ error: 'unauthorized' }, 401);

  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);

  if (!c.req.header('content-type')?.includes('application/json')) {
    return c.json({ ok: false, error: 'unsupported_media_type' }, 415);
  }

  let client: import('pg').PoolClient | null = null;

  try {
    const json = await c.req.json();
    const parsed = bodySchema.parse(json);

    // récupérer le plan existant (et vérifier le user)
    const { rows: existingRows } = await pool.query(
      'SELECT * FROM plans WHERE id = $1 AND user_id = $2',
      [id, auth.userId],
    );
    if (!existingRows.length) {
      return c.json({ ok: false, error: 'not_found' }, 404);
    }
    const existing = existingRows[0];

    const dueAtIso = parsed.dueAt
      ? new Date(parsed.dueAt).toISOString()
      : existing.due_at.toISOString?.() ?? existing.due_at;

    const effectiveDependsOn =
      parsed.dependsOn === undefined ? existing.depends_on : parsed.dependsOn;

    const effectiveStatus =
      parsed.status ??
      (parsed.actualMinutes != null && parsed.actualMinutes > 0
        ? 'done'
        : existing.status);

    const effectiveProjectId =
      parsed.projectId === undefined ? existing.project_id : parsed.projectId;

    const effectivePriority =
      parsed.priority === undefined ? existing.priority : parsed.priority;

    const effectiveRecurrenceRule =
      parsed.recurrenceRule === undefined
        ? existing.recurrence_rule
        : parsed.recurrenceRule;

    // check dépendance dans les plans du user
    if (effectiveDependsOn != null) {
      const { rows: depRows } = await pool.query(
        'SELECT id, title, due_at FROM plans WHERE id = $1 AND user_id = $2',
        [effectiveDependsOn, auth.userId],
      );
      if (!depRows.length) {
        return c.json(
          { ok: false, error: 'dependency_not_found', dependencyId: effectiveDependsOn },
          400,
        );
      }

      const dep = depRows[0];
      if (new Date(dueAtIso) < new Date(dep.due_at)) {
        return c.json(
          {
            ok: false,
            error: 'invalid_dependency_due_at',
            message: `Due date must be after or equal to dependency "${dep.title}".`,
            dependencyDueAt: new Date(dep.due_at).toISOString(),
          },
          400,
        );
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const sql = `
      UPDATE plans
      SET
        title = COALESCE($1, title),
        expected_minutes = COALESCE($2, expected_minutes),
        actual_minutes   = COALESCE($3, actual_minutes),
        due_at           = COALESCE($4, due_at),
        note             = COALESCE($5, note),
        depends_on       = $6,
        status           = COALESCE($7, status),
        project_id       = $8,
        priority         = $9,
        recurrence_rule  = $10
      WHERE id = $11 AND user_id = $12
      RETURNING
        id,
        title,
        expected_minutes AS "expectedMinutes",
        actual_minutes   AS "actualMinutes",
        due_at           AS "dueAt",
        note,
        depends_on       AS "dependsOn",
        status,
        created_at       AS "createdAt",
        project_id       AS "projectId",
        priority,
        recurrence_rule  AS "recurrenceRule"
    `;

    const values = [
      parsed.title ?? null,
      parsed.expectedMinutes ?? null,
      parsed.actualMinutes ?? null,
      dueAtIso,
      parsed.note ?? null,
      effectiveDependsOn,
      effectiveStatus,
      effectiveProjectId,
      effectivePriority,
      effectiveRecurrenceRule,
      id,
      auth.userId,
    ];

    const { rows } = await client.query(sql, values);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return c.json({ ok: false, error: 'not_found_after_update' }, 404);
    }
    const plan = rows[0];

    const db = await getMongoDb();

    await db.collection('events').insertOne({
      type: 'plan_updated',
      at: new Date(),
      userId: auth.userId,
      planId: plan.id,
      dependsOn: effectiveDependsOn,
      payload: {
        ...parsed,
        dueAt: dueAtIso,
        status: effectiveStatus,
        projectId: effectiveProjectId,
        priority: effectivePriority,
        recurrenceRule: effectiveRecurrenceRule,
      },
    });

    await db.collection('plans').updateOne(
      { pgId: plan.id, userId: auth.userId },
      {
        $set: {
          title: plan.title,
          expectedMinutes: plan.expectedMinutes,
          actualMinutes: plan.actualMinutes,
          dueAt: plan.dueAt,
          note: plan.note,
          dependsOn: plan.dependsOn ?? null,
          status: plan.status,
          projectId: effectiveProjectId,
          priority: effectivePriority,
          recurrenceRule: effectiveRecurrenceRule,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    await client.query('COMMIT');
    return c.json({ ok: true, plan });
  } catch (err: any) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch {}
    if (err instanceof ZodError) {
      return c.json({ ok: false, error: 'validation', issues: err.errors }, 400);
    }
    console.error('updatePlan error', err);
    return c.json({ ok: false, error: 'internal' }, 500);
  } finally {
    try {
      if (client) client.release();
    } catch {}
  }
}
