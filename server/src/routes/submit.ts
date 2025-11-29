// server/src/routes/submit.ts
import { Context } from 'hono';
import { z, ZodError } from 'zod';
import { pool } from '../db/pg.js';
import { getMongoDb } from '../db/mongo.js';
import type { JWTPayload } from '../middlewares/auth.js';

const bodySchema = z.object({
  title: z.string().trim().min(3).max(200),
  expectedMinutes: z.coerce.number().int().gt(0),

  actualMinutes: z.coerce.number().int().min(0).nullable().optional(),

  // on accepte juste une string, on valide nous-mêmes ensuite
  dueAt: z.string(),

  note: z.string().trim().max(500).nullable().optional(),

  // dépendance optionnelle (comme dans updatePlan)
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

  // nouveaux champs
  projectId: z.coerce.number().int().positive().nullable().optional(),
  priority: z.coerce.number().int().min(-5).max(5).optional(),
  recurrenceRule: z.string().trim().max(500).nullable().optional(),
});

export default async function submitHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let client: import('pg').PoolClient | null = null;

  try {
    if (!c.req.header('content-type')?.includes('application/json')) {
      return c.json({ ok: false, error: 'unsupported_media_type' }, 415);
    }

    const json = await c.req.json();
    const parsed = bodySchema.parse(json);

    const d = new Date(parsed.dueAt);
    if (Number.isNaN(d.getTime())) {
      return c.json(
        { ok: false, error: 'invalid_due_at', message: 'Invalid dueAt datetime' },
        400,
      );
    }
    const dueAtIso = d.toISOString();

    // 🔥 auto-status
    const effectiveStatus =
      parsed.status ??
      (parsed.actualMinutes != null && parsed.actualMinutes > 0
        ? 'done'
        : 'not_started');

    const effectiveDependsOn =
      parsed.dependsOn === undefined ? null : parsed.dependsOn;

    const effectiveProjectId =
      parsed.projectId === undefined ? null : parsed.projectId;

    const effectivePriority = parsed.priority ?? 0;
    const effectiveRecurrenceRule =
      parsed.recurrenceRule === undefined ? null : parsed.recurrenceRule;

    // 🔍 check dependency dans les plans DU USER
    if (effectiveDependsOn != null) {
      const { rows: depRows } = await pool.query(
        'SELECT id, title, due_at FROM plans WHERE id = $1 AND user_id = $2',
        [effectiveDependsOn, auth.userId],
      );

      if (!depRows.length) {
        return c.json(
          {
            ok: false,
            error: 'dependency_not_found',
            dependencyId: effectiveDependsOn,
          },
          400,
        );
      }

      const dep = depRows[0];
      const depDue = new Date(dep.due_at);
      const thisDue = new Date(dueAtIso);

      if (thisDue < depDue) {
        return c.json(
          {
            ok: false,
            error: 'invalid_dependency_due_at',
            message: `Due date must be after or equal to dependency "${dep.title}".`,
            dependencyDueAt: depDue.toISOString(),
          },
          400,
        );
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const q = `
      INSERT INTO plans (
        title,
        expected_minutes,
        actual_minutes,
        due_at,
        note,
        depends_on,
        status,
        user_id,
        project_id,
        priority,
        recurrence_rule
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        user_id          AS "userId",
        project_id       AS "projectId",
        priority,
        recurrence_rule  AS "recurrenceRule"
    `;

    const values = [
      parsed.title,
      parsed.expectedMinutes,
      parsed.actualMinutes ?? null,
      dueAtIso,
      parsed.note ?? null,
      effectiveDependsOn,
      effectiveStatus,
      auth.userId,             // 👈 user_id
      effectiveProjectId,
      effectivePriority,
      effectiveRecurrenceRule,
    ];

    const { rows } = await client.query(q, values);
    const plan = rows[0];

    const db = await getMongoDb();

    await db.collection('events').insertOne({
      type: 'plan_submitted',
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
          userId: auth.userId,
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
    return c.json({ ok: true, plan }, 201);
  } catch (err: any) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch {}

    if (err instanceof ZodError) {
      return c.json(
        { ok: false, error: 'validation', issues: err.errors },
        400,
      );
    }

    console.error('submit error', err);
    return c.json({ ok: false, error: 'internal' }, 500);
  } finally {
    try {
      if (client) client.release();
    } catch {}
  }
}
