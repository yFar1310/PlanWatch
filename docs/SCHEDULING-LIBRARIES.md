# Scheduling libraries and administration polish

20 October 2026, PlanWatch2.0.

## Components and cost

- [DHTMLX Gantt Community 10.0.3](https://github.com/DHTMLX/gantt): MIT, daily/hourly and weekly Gantt, native drag/drop and edge resizing, existing dependency connectors. The exact installed edition's MIT notice is included in `public/THIRD_PARTY_NOTICES.txt`.
- [FullCalendar Standard 6.1.20](https://github.com/fullcalendar/fullcalendar/tree/v6.1.20): MIT Vue 3, TimeGrid and Interaction plugins, Luxon 3 for Europe/Paris. No Premium plugins or license key. Native horizontal overflow keeps the week readable on small screens.
- [TanStack Vue Table 8.21.3](https://github.com/TanStack/table/tree/v8.21.3): MIT headless row/sorting engine. Existing task cards, editors, completion confirmation and Trash actions remain available. Sort by title, priority, planned date or status, ascending/descending. Sorting covers loaded rows; a visible message explains this when another server page exists. The original server order is the default.

Gantt and calendar code are separate lazy-loaded chunks. No new hosted service, paid plan or DB migration is needed. Existing D1 quotas still apply to requests. Scheduling performs one PATCH at drop/resize completion, then one timeline read to reconcile the period; pointer movement does not send requests.

## Scheduling contract

Daily Gantt is the default, Weekly is selected beside the chart, and Calendar shows a Monday-based week. Timed changes snap to 15 minutes. All-day Gantt changes snap to days. Moving an all-day span preserves its calendar-day length across daylight-saving weekends. Existing dependencies are visualized, without automatically shifting other tasks or changing their status. Edit prerequisites in the task dialog.

The chart captures the task version at drag start. A change updates only `plannedDate`, `plannedEndDate`, `startTime`, `endTime` and the expected version through the existing owner-scoped PATCH endpoint. Updates retain optimistic concurrency and atomic history. While saving, navigation and further drags are disabled. An unsaved editor draft must be saved or discarded first.

Invalid changes revert immediately with a message. A server failure reverts and reads the authoritative schedule once, including after a timeout whose write may have committed. Writes are never automatically replayed. Authentication/ban errors go through the existing private-view clearing flow and do not trigger another private read. Late responses after component disposal are ignored.

Both libraries use exclusive all-day ends; D1 uses inclusive end dates. Shared adapters convert these explicitly. FullCalendar uses Paris timezone conversion; DHTMLX uses floating date components, never UTC serialization. An unrepresentable local hour produces an explicit editor fallback. Timed tasks must still begin and end on the same day; overnight drag/resize is rejected. Use an untimed multi-day range for a task spanning days.

Double-click a Gantt task or click a calendar event to edit details. A collapsible list of task buttons offers an alternative to dragging, including on touch devices. Calendar events support Enter/Space to open the editor. Existing Plan a task creation remains available.

## Administration

The dashboard uses consistent statistic cards, aligned form controls, status badges, fixed action columns for invitations, and matching metric grids for members. On mobile these reflow into two-column statistics and single-column forms. Light/dark colors use the app's existing theme tokens.

Unused invitations can be revoked. Invitations of any status can be deleted after confirmation, including active links and older used/expired/revoked records. Deleting an unused invitation prevents redemption. Deleting a used invitation preserves its member account and tasks; access is controlled separately by Ban member. Newly displayed links clear when the same invitation is revoked/deleted. Failures stay visible inside the confirmation dialog so the administrator can retry or cancel.

## Verification limits

`npm run check` passes with 141 tests (73 Worker/D1, 47 Vue and 21 client/asset checks), strict type checks and both builds. Automated coverage includes real library initialization in jsdom, safe rendering of untrusted titles, Paris event conversion, Gantt hooks and rollback, calendar resize callbacks, version conflicts, serialized writes, account failures, draft protection, sorting, and invitation deletion/admission isolation. These tests do not simulate a physical pointer or phone touch, and jsdom cannot validate alignment or responsive layout. The in-app browser runtime failed to initialize with `Importing module "node:process" is not allowed in node_repl`; desktop/phone visual and gesture acceptance therefore remains open.
