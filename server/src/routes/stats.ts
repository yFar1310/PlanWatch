// server/src/routes/stats.ts
import type { Context } from 'hono';
import { pool } from '../db/pg.js';

export default async function statsHandler(c: Context) {
  try {
    const { rows } = await pool.query(`
      SELECT
        -- plans dus aujourd'hui
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

        -- plans dans les 7 prochains jours
        COUNT(*) FILTER (
          WHERE due_at >= NOW()
            AND due_at < NOW() + INTERVAL '7 days'
        ) AS "upcomingCount",

        -- plans qui ont au moins UNE dépendance
        COUNT(*) FILTER (
          WHERE depends_on IS NOT NULL
        ) AS "plansWithDependency"
      FROM plans;
    `);

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
