# PlanWatch 2.0 implementation roadmap

## 1. Prove the foundation

Set up Vue + TypeScript, Hono, and the local Cloudflare runtime. Prototype D1 persistence, atomic task/history writes, dependency validation under concurrent edits, and PDF compatibility. Verify the free-tier budget assumptions. Preserve the option to use managed PostgreSQL if the prototype exposes unacceptable compromises.

Done: a documented local command starts a working prototype; build, type checks, and meaningful reliability tests pass. No old implementation is copied into the new app.

Current status: the local prototype is implemented. See [foundation findings](FOUNDATION.md) for passing checks and remaining browser, hosted-performance, and free-tier report-rendering gates. D1 is provisionally suitable for continuing the local rebuild; the complete hosted budget is not yet proven.

## 2. Build the task model and daily interface together

Implement title-first capture, optional dates/estimates, explicit statuses, actual completion timestamps, search, pagination, rescheduling, and deletion recovery. Use reusable accessible controls, readable light/dark themes, and visible saving/error/retry states. Today is the default screen; task details retain the user's context.

Done: create, edit, clear, complete, reopen, reschedule, delete, restore, and find tasks work consistently after refresh. Drafts survive recoverable failures and repeated submissions do not duplicate tasks.

Current status: Today, optional planned days, rescheduling, database search/filters, durable Trash, Light/Dark/System appearance, and device-local drafts are implemented. Type checks, 28 Workers integration tests, production builds, and local HTTP checks pass. Browser interaction and visual review remain open; see [daily-planning notes](DAILY-PLANNING.md).

## 3. Deliver phone access

Add secure personal authentication, Cloudflare preview deployment, one-origin API/static delivery, PWA installation, safe-area layouts, and connection feedback. Measure actual resource usage. Add backups and test restoration before migrating any existing personal data.

Done: the app works on the user's real phone while the development laptop is off, with tested sessions, persistence, recovery, and rollback.

## 4. Add goals, tracking, and the map

Add an editable philosophy/goals profile, optional work sessions and short reflections, and detailed event snapshots. Model task/project/goal relationships and dependencies in the validated datastore. Add readable nodes, tap-to-detail, search, focused chains, fullscreen, and a text alternative. Preserve advanced critical-path analysis with explicit assumptions.

Done: the map agrees with task/goal data, invalid dependencies are rejected, and personal-use workloads remain responsive.

## 5. Add Workers AI coaching

Build bounded evidence bundles from tasks, events, relationships, and the philosophy profile. Calculate statistics in code and use a free-eligible model for interpretation. Provide task comparisons and suggestions with evidence, uncertainty, and accept/adjust/dismiss actions. Test recommendation quality and keep paid fallback disabled.

Done: advice follows stated goals, cites real records, and never blocks normal task actions when unavailable.

## 6. Automate weekly reports

Run a durable report Workflow at the chosen Sunday-evening time in Europe/Paris, including daylight-saving handling. Collect consistent evidence, compute statistics, generate AI advice, render a verified PDF, store it privately in R2, and email the configured recipient. Track progress, report history, retries, and duplicate prevention.

Done: the report arrives through an end-to-end scheduled test, stays private, and recovers from AI/storage/email failures without unnecessarily repeating completed work.

## 7. Pilot and release

Use the app for at least one full week including a Sunday report. Verify phone/desktop flows, accessibility, slow networks, session expiry, stale edits, data restoration, deployment rollback, and measured costs. Fix observed friction before adding more features.

Later: full offline write synchronization, recurrence, advanced habits/calendar planning, and additional notification channels.
