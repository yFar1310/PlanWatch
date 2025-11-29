// server/src/routes/stats.ts
import type { Context } from 'hono';
import { pool } from '../db/pg.js';
import type { JWTPayload } from '../middlewares/auth.js';

export default async function statsHandler(c: Context) {
  try {
    const user = c.get('user') as JWTPayload | undefined;
    if (!user) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE due_at::date = CURRENT_DATE
        ) AS "todayCount",

        COALESCE(
          SUM(expected_minutes) FILTER (
            WHERE due_at::date = CURRENT_DATE
          ),
          0
        ) AS "todayExpectedMinutes",

        COALESCE(
          SUM(actual_minutes) FILTER (
            WHERE due_at::date = CURRENT_DATE
          ),
          0
        ) AS "todayActualMinutes",

        COUNT(*) FILTER (
          WHERE due_at >= NOW()
            AND due_at < NOW() + INTERVAL '7 days'
        ) AS "upcomingCount",

        COUNT(*) FILTER (
          WHERE depends_on IS NOT NULL
        ) AS "plansWithDependency"
      FROM plans
      WHERE (user_id = $1 OR user_id IS NULL)
      `,
      [user.userId],
    );

    const row =
      rows[0] ?? {
        todayCount: 0,
        todayExpectedMinutes: 0,
        todayActualMinutes: 0,
        upcomingCount: 0,
        plansWithDependency: 0,
      };

    return c.json(row);
  } catch (e: any) {
    console.error('stats error', e);
    return c.json(
      {
        ok: false,
        error: 'internal',
        message: e?.message ?? 'stats_failed',
      },
      500,
    );
  }
}
