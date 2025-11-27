import type { Context } from 'hono';
import { pool } from '../db/pg.js';

export default async function statsHandler(c: Context) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(expected_minutes) FILTER (WHERE due_at::date = CURRENT_DATE), 0) AS today_expected,
      COALESCE(SUM(actual_minutes)   FILTER (WHERE due_at::date = CURRENT_DATE), 0) AS today_actual,
      COUNT(*)  FILTER (WHERE due_at::date = CURRENT_DATE)::int AS today_count,
      COUNT(*) FILTER (
      WHERE due_at >= now()
        AND due_at < now() + interval '7 days'
        AND array_length(depends_on, 1) > 0
    ) AS "plansWithDependency"
  FROM plans
  WHERE status = 'active'
`);

  const row = rows[0] ?? {};

  return c.json({
    todayExpectedMinutes: Number(row.today_expected ?? 0),
    todayActualMinutes:   Number(row.today_actual ?? 0),
    todayCount:           Number(row.today_count ?? 0),
    upcomingCount:        Number(row.upcoming_count ?? 0),
    plansWithDependency:  Number(row.deps_count ?? 0),
  });
}
