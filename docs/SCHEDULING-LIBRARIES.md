# Scheduling libraries and administration polish

Updated 21 October 2026, PlanWatch2.0.

## Components and cost

- [FullCalendar Standard 6.1.20](https://github.com/fullcalendar/fullcalendar/tree/v6.1.20): MIT Vue 3, TimeGrid, DayGrid and Interaction plugins, Luxon 3 for Europe/Paris. Day, Week and Month views. No Premium plugins or license key. Native horizontal overflow keeps the week readable on small screens. DHTMLX and its stylesheet have been removed.
- [TanStack Vue Table 8.21.3](https://github.com/TanStack/table/tree/v8.21.3): MIT headless row/sorting engine. Existing task cards, editors, completion confirmation and Trash actions remain available. Sort by title, priority, planned date or status, ascending/descending. Sorting covers loaded rows; a visible message explains this when another server page exists. The original server order is the default.

The calendar is a single lazy-loaded component with an inline load/render error boundary and explicit retry. No new hosted service, paid plan or DB migration is needed. Existing D1 quotas still apply to requests. Scheduling performs one PATCH at drop/resize completion, then one timeline read to reconcile the period; pointer movement does not send requests.

## Scheduling contract

Day is the default. A dropdown switches to Week or Month. Weeks begin on Monday; month queries include all 42 visible cells, including adjacent-month days. Timed moves snap to 15 minutes. All-day changes use calendar dates across daylight-saving weekends. Dependencies remain editable in task details; moving a task does not move its prerequisite or change its status.

The chart captures the task version at drag start. A change updates only `plannedDate`, `plannedEndDate`, `startTime`, `endTime` and the expected version through the existing owner-scoped PATCH endpoint. Updates retain optimistic concurrency and atomic history. While saving, navigation and further drags are disabled. An unsaved editor draft must be saved or discarded first.

Invalid changes revert immediately with a message. A server failure reverts and reads the authoritative schedule once, including after a timeout whose write may have committed. Writes are never automatically replayed. Authentication/ban errors go through the existing private-view clearing flow and do not trigger another private read. Late responses after component disposal are ignored.

FullCalendar uses exclusive all-day ends; D1 uses inclusive end dates. The adapter converts explicitly in Europe/Paris. Timed tasks must begin and end on the same day; overnight selection/drag/resize is rejected. Use an untimed multi-day range for an activity spanning days.

Click an event or press Enter/Space to edit details. A collapsible task list offers an alternative to dragging. Empty-slot selection pre-fills a capture dialog with the selected interval; creating the activity still requires confirmation. Day-number links switch the internal view without document navigation. All chart data is provided locally from the existing authenticated API; no external calendar service is contacted.


## Administration

The dashboard uses consistent statistic cards, aligned form controls, status badges, fixed action columns for invitations, and matching metric grids for members. On mobile these reflow into two-column statistics and single-column forms. Light/dark colors use the app's existing theme tokens.

Unused invitations can be revoked. Invitations of any status can be deleted after confirmation, including active links and older used/expired/revoked records. Deleting an unused invitation prevents redemption. Deleting a used invitation preserves its member account and tasks; access is controlled separately by Ban member. Newly displayed links clear when the same invitation is revoked/deleted. Failures stay visible inside the confirmation dialog so the administrator can retry or cancel.

## Verification limits

Automated coverage exercises real FullCalendar initialization and view changes in jsdom, safe rendering of untrusted titles, Paris conversion, selection intervals, resize/drop callbacks, version conflicts, serialized writes, account failures, draft protection, sorting and invitation isolation. These tests do not simulate a physical pointer or phone touch, and jsdom cannot validate alignment or responsive layout. The browser tool failed to initialize in this session; desktop/phone visual and gesture verification remains open.
