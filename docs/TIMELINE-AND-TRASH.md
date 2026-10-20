# Timeline planning and permanent Trash deletion

Implemented on PlanWatch2.0, 20 October 2026. Migration 0005 adds optional schedule fields, indexes and content-free purge records. Existing task values and historical snapshots are preserved; the new fields start as null.

## Using the timeline

The Timeline navigation entry offers Gantt and Calendar views. Gantt opens in Daily mode with a 24-hour axis. A small Daily/Weekly dropdown beside the graph switches to a Monday-based week with one column per day. Timed bars preserve their start/end minute positions in Daily; untimed tasks cover the day. Weekly displays inclusive date spans, dependency connectors when both tasks are loaded, priority/status indicators, period navigation and date jumps. Calendar shows a Monday-based week with an all-day area and a 24-hour grid. Overlapping time slots share columns. Both views scroll horizontally on narrow screens and use the current light/dark theme.

A planned day remains the task's start date. An optional end date extends an all-day task through that date, inclusive. Optional start/end times define a slot within one day. Both times are required together; end must be later than start. A timed task cannot span multiple days. Clearing its planned day also clears the scheduling details in the editor. API validation and SQL triggers enforce the same rules, including partial edits.

All time fields are Europe/Paris wall-clock values, independent of browser timezone. Date arithmetic uses calendar-day ordinals, including daylight-saving weekends. These fields do not represent UTC instants or elapsed duration across a daylight-saving transition; actual minutes remain a separate editable field.

Click a task/bar to edit its details in a dialog. Changing status to Done keeps the existing confirmation step. Click Plan a task, or an empty calendar column, to open task capture without leaving the timeline; pointer selection pre-fills a half-hour slot position and a one-hour duration capped at 23:59. Keyboard activation of an empty day defaults to 09:00. Dates/times, priority and an optional prerequisite remain editable before saving. Canceling retains the workspace-scoped draft. A successful save refreshes the same view and period.

The API returns interval overlaps for the requested range, including tasks that start before it. Search, priority and status filters apply in D1. Ranges are capped at 42 days and each page at 100 tasks; a visible count and Load more button indicate partial results. Cursors bind workspace, range and filters. An unscheduled-task count links back to Tasks. Dependencies outside the loaded range/page keep their text reference; their connector appears when both tasks are loaded.

## Permanent deletion

Moving a task to Trash stays reversible. In Trash, the member can permanently delete one task, select multiple tasks across loaded pages (up to 100 per batch), or empty the entire workspace Trash. Every permanent operation requires a separate confirmation. Empty Trash clearly includes records outside current search/priority filters and loaded pages.

A single conditional SQL DELETE checks every selected ID, workspace, Trash state and version. A stale, restored, missing or foreign task causes the complete selection to remain unchanged. Empty Trash obtains a fresh total and event boundary before confirmation; only tasks still in Trash with no later activity are eligible. New deletions or restore/redelete activity after that boundary are kept. Live tasks and other workspaces are always excluded.

A SQL trigger removes the purged task's saved activity snapshots in the same operation. A failure rolls back the task removal, history cleanup and purge record. Only task ID, workspace ID, creation key and purge timestamp remain, with no title, notes or schedule. This prevents an old create request from recreating permanently deleted content. A replay returns HTTP 410; the UI retains its draft and requires a new explicit Add task action with a new request key. No write is automatically replayed.

Permanent deletion removes the task from the app and current analytics/history; it has no Undo or normal restore action. Previously exported private backups are independent files and are not rewritten by this operation.

## Recovery and verification

Before publication, a remote SQL export with checksum was restored in an isolated local D1 copy: 3 hosted tasks and 10 task events passed integrity, round-trip, foreign-key, trigger and behavior checks. Migration 0005 was then tested on that restored copy. Hash comparisons verified all preexisting task values and event snapshots were unchanged, scheduling defaults were null, and permanent deletion/history cleanup worked on an isolated verification task. No hosted task was purged during implementation.

`npm run check` passes: 71 Workers integration tests, 33 Vue component tests, 21 client/service-worker/asset checks, strict type checks and both builds (125 tests total). Coverage includes atomic/stale/cross-workspace deletion, history rollback, old-create replay, full Trash beyond the first page, concurrent restore protection, schedule validation/snapshots, interval overlap and pagination, calendar layout calculations, multi-selection confirmation and in-calendar capture.

Component tests use jsdom and do not prove actual visual layout, native dialog behavior or touch interaction. Real desktop/mobile rendering, horizontal/vertical scrolling and phone interaction remain acceptance checks. Task scheduling uses the new dates/times and clickable editors; drag-resize scheduling and recurring tasks are future work.


## Local schema mismatch fixed

The owner’s already-running local dev server reloaded the new Worker before migration 0005 had run, causing `no such column: planned_end_date`. The local database was backed up, 0005 was applied without stopping the server, and live HTTP checks of `/api/session`, `/api/tasks` and the daily `/api/timeline` returned 200. The hosted workflow separately completed its migration and deployment successfully.

The dev startup, local migration script and local backup now explicitly use `wrangler.jsonc` instead of relying on Vite's generated deployment redirect. Startup applies pending migrations before Vite starts. When adding migrations to a session whose server is already running, run `npm run db:migrate:local` before changing Worker queries to use their columns; hot reload does not rerun the startup command. Never delete local state to fix a schema mismatch.
