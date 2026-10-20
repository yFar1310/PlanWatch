# Timeline planning and permanent Trash deletion

Implemented on PlanWatch2.0, 20 October 2026. Migration 0005 adds optional schedule fields, indexes and content-free purge records. Existing task values and historical snapshots are preserved; the new fields start as null.

## Using the timeline

Updated 21 October 2026: the navigation entry is now **Calendar**, with Day (default), Week and Month views using FullCalendar Standard. The Gantt view and DHTMLX dependency were removed in response to user feedback. The layout uses a familiar time grid, all-day row, date navigation, today indicator and direct event editing. Day/Month fit a narrow viewport; Week retains native horizontal scrolling. Light/dark themes remain available. See the [user guide](GUIDE-UTILISATEUR.md).


A planned day remains the task's start date. An optional end date extends an all-day task through that date, inclusive. Optional start/end times define a slot within one day. Both times are required together; end must be later than start. A timed task cannot span multiple days. Clearing its planned day also clears the scheduling details in the editor. API validation and SQL triggers enforce the same rules, including partial edits.

All time fields are Europe/Paris wall-clock values. FullCalendar uses the Luxon named-timezone plugin. Date arithmetic uses calendar-day ordinals, including daylight-saving weekends. These fields do not represent elapsed duration across a daylight-saving transition; actual minutes remain a separate editable field.

Click an event, or focus it and press Enter/Space, to edit details in a dialog. A collapsible task list provides an alternative to dragging. Changing status to Done retains confirmation. Click Plan a task or select an empty calendar interval to open capture without leaving the calendar. Selection pre-fills its dates/times; saving requires an explicit Add task action. Closing via the cross, Escape or a backdrop click preserves the scoped draft. A successful save refreshes the same period. Valid drag/drop and edge resizing save directly through the versioned task endpoint.


The API returns interval overlaps for the requested range, including tasks that start before it. Search, priority and status filters apply in D1. Ranges are capped at 42 days and each page at 100 tasks; a visible count and Load more button indicate partial results. Cursors bind workspace, range and filters. An unscheduled-task count links back to Tasks. Dependencies remain available in task details, including when the prerequisite falls outside the visible period.

## Permanent deletion

Moving a task to Trash stays reversible. In Trash, the member can permanently delete one task, select multiple tasks across loaded pages (up to 100 per batch), or empty the entire workspace Trash. Every permanent operation requires a separate confirmation. Empty Trash clearly includes records outside current search/priority filters and loaded pages.

A single conditional SQL DELETE checks every selected ID, workspace, Trash state and version. A stale, restored, missing or foreign task causes the complete selection to remain unchanged. Empty Trash obtains a fresh total and event boundary before confirmation; only tasks still in Trash with no later activity are eligible. New deletions or restore/redelete activity after that boundary are kept. Live tasks and other workspaces are always excluded.

A SQL trigger removes the purged task's saved activity snapshots in the same operation. A failure rolls back the task removal, history cleanup and purge record. Only task ID, workspace ID, creation key and purge timestamp remain, with no title, notes or schedule. This prevents an old create request from recreating permanently deleted content. A replay returns HTTP 410; the UI retains its draft and requires a new explicit Add task action with a new request key. No write is automatically replayed.

Permanent deletion removes the task from the app and current analytics/history; it has no Undo or normal restore action. Previously exported private backups are independent files and are not rewritten by this operation.

## Recovery and verification

Before publication, a remote SQL export with checksum was restored in an isolated local D1 copy: 3 hosted tasks and 10 task events passed integrity, round-trip, foreign-key, trigger and behavior checks. Migration 0005 was then tested on that restored copy. Hash comparisons verified all preexisting task values and event snapshots were unchanged, scheduling defaults were null, and permanent deletion/history cleanup worked on an isolated verification task. No hosted task was purged during implementation.

The full check includes Worker/D1 integration tests, Vue component tests, client/service-worker/asset checks, strict type checks and both builds. Coverage includes atomic/stale/cross-workspace deletion, history rollback, old-create replay, full Trash beyond the first page, concurrent restore protection, scheduling validation, interval pagination, real calendar-library initialization, selection and resize adapters, reversion, multi-selection confirmation and in-calendar capture.

Component tests use jsdom and do not prove actual visual layout, native dialog behavior or touch interaction. Real desktop/mobile rendering, horizontal/vertical scrolling and phone interaction remain acceptance checks. Task scheduling supports drag/drop and edge resizing; recurring tasks remain future work. See [library integration](SCHEDULING-LIBRARIES.md).


## Local schema mismatch fixed

The owner’s already-running local dev server reloaded the new Worker before migration 0005 had run, causing `no such column: planned_end_date`. The local database was backed up, 0005 was applied without stopping the server, and live HTTP checks of `/api/session`, `/api/tasks` and the daily `/api/timeline` returned 200. The hosted workflow separately completed its migration and deployment successfully.

The dev startup, local migration script and local backup now explicitly use `wrangler.jsonc` instead of relying on Vite's generated deployment redirect. Startup applies pending migrations before Vite starts. When adding migrations to a session whose server is already running, run `npm run db:migrate:local` before changing Worker queries to use their columns; hot reload does not rerun the startup command. Never delete local state to fix a schema mismatch.
