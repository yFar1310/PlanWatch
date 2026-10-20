# Daily planning and appearance

Implemented locally on 19 October 2026. The original baseline migration is unchanged; `0002_daily_planning.sql` adds the optional planned day, indexes, and snapshots for future activity events. Existing tasks keep their data with no planned day. Earlier event snapshots remain intact and may omit `plannedDate`.

## Behavior

- **Today** shows open tasks planned for today or earlier. Future work, undated tasks, completed tasks, and deleted tasks remain available in the other views. The day follows Europe/Paris and refreshes when midnight passes or the app becomes visible again.
- **Tasks** supports Open, Done, and All. Search checks titles and notes in the database before pagination. `%`, `_`, and quotes are literal characters. SQLite's built-in `lower` provides ASCII case folding; full Unicode case folding and accent-insensitive search are not implemented.
- **Planned day** is a nullable `YYYY-MM-DD` calendar date, not a timestamp or deadline. Users can select a date, choose Today/Tomorrow, or clear it. Both API and database reject impossible dates. Rescheduling does not change completion status.
- **Trash** lists saved deleted records across refreshes, newest deletion first, with search and restoration. Restoring keeps the saved content and planned day. Previously unlinked dependencies are not automatically reconnected. No permanent-deletion action is exposed.
- **Appearance** uses a clickable sun/moon button in the top bar to switch directly between light and dark. Before the first manual choice, it follows the device theme. A saved choice applies before app rendering to avoid a light flash. Native inputs/selects use the matching color scheme. Each browser/device stores its own preference.
- **Drafts** preserve capture text, selected day, create retry key, and unsaved task fields on the current browser/device. Save errors retain them. Original edit versions are preserved across refreshes; conflicting drafts cannot overwrite newer records. Choosing “Replace draft with saved version” explicitly discards that draft. Browser storage failure falls back to memory with a visible explanation. Drafts do not sync between devices or provide offline writes.

Requests use a sequence guard so an earlier search response cannot replace a newer view. Searching is debounced, pages are bounded, and cursors are bound to the selected view/filter/search. Task action controls wait for confirmation from the API. Focus returns to task capture after adding and to the list after other successful actions.

## Verification

`npm run check` passes: strict type checks, 28 integration tests in the Workers runtime, and both production builds. New coverage includes date rescheduling/clearing and snapshots; API/database date validation; Today inclusion/exclusion; Paris daylight-saving boundaries; search beyond the first page and literal search characters; status filtering; durable Trash; Unicode cursor transport; filter-bound cursors; old creation keys across the migration; replay after dependency deletion; and Trash pagination by deletion time.

The existing local database accepted migration 0002. HTTP checks on a separate test server passed for Today, rescheduling out of Today, search, Trash, restoration, date clearing, and serving the early appearance bootstrap. Only the labeled verification task was changed, then soft-deleted.

All twelve checked color pairs (main/muted text, selected controls, primary buttons, and errors in both themes) exceeded 4.5:1 in a mathematical contrast check. This does not replace a visual accessibility review. The provided browser connection still fails during setup, so mobile/desktop screenshots, native date-control layout, actual theme interaction/persistence, draft recovery in the browser, keyboard flows, and assistive-technology checks remain pending. The backend tests and HTTP checks do not exercise those browser behaviors.

## Next gate

Complete desktop/phone browser review, then add personal authentication, PWA installation, hosted usage measurements, backups with tested recovery, and deployment rollback before public access or migration of personal data. AI, reporting, email, and paid services remain inactive.

## Priorities and deliberate completion (20 October 2026)

Migration 0004 adds Urgent, High, Medium and Low, defaulting existing tasks to Medium. Priority is editable at capture and in details; server-side filters apply before pagination in Today, Tasks and Trash. Cursors bind priority and workspace as well as the other filters. Old creation payloads remain compatible with retries using the default priority.

An optional prerequisite picker searches all of your saved tasks through bounded server-side pages; it is not restricted to the current visible list. Selecting no prerequisite leaves a task independent. The database rejects missing/cross-workspace prerequisites, cycles, and a new completion while the prerequisite is unfinished. Completing the prerequisite enables completion; removing the relationship makes the task independent. Reopening an already completed prerequisite does not rewrite historical child completions. Deleting a prerequisite unlinks its dependents atomically, as before.

Clicking Complete opens a native confirmation dialog, initially focused on Keep working, with Escape cancellation. Choosing Done through the details form uses the same confirmation. Cancellation does not write anything. Reopening a task remains a direct action. Every task row outside Trash, including completed tasks, has a labeled Delete control. Deletion remains reversible through Undo and Trash.
