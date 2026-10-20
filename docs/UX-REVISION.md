# UX revision — 21 October 2026

## Implemented

- An idea is saved directly with **Save idea** or Enter. An inline **IDEA SAVED** receipt explains that scheduling is optional. Dismissing this receipt retains the idea. Manual date/time editing is the primary next step; suggestions are in an optional section and remain accessible for older ideas.
- The suggestion dialog describes a chronological free-slot search, its available-window inputs and its limitations. It does not claim AI personalization or knowledge of external calendars. Existing snapshot/version checks still protect confirmation.
- **Calendar** replaces the old Timeline/Gantt interface. FullCalendar Standard supplies Day (default), Week and Month, selectable empty intervals, drag/drop, resizing, keyboard event editing and internal day navigation. Month requests include all 42 visible cells. DHTMLX, its large chunk and its stylesheet were removed.
- Calendar initialization/loading errors stay inside the page with retry and task-list actions. The deployment smoke check now fetches the actual lazy calendar JavaScript and verifies its content type.
- All app dialogs support a primary pointer click starting and ending outside the dialog. Interior padding and drags starting inside do not dismiss. Pending operations prevent dismissal; closing preserves drafts. Escape, focus restoration and the logout confirmation remain available.
- Icon buttons have descriptive native hover titles alongside accessible names. The French in-app guide and [user manual](GUIDE-UTILISATEUR.md) explain ideas, manual scheduling, suggestions, calendar interactions, dependencies, Trash, drafts and account usage.

## Full-page 400 investigation

The user reports that opening Timeline replaces the entire page with a generic 400 response while the address remains `planwatch-v2-preview.pages.dev`. This is distinct from an inline API error, and does not establish a Clerk OAuth problem.

Read-only public probes returned HTTP 200 with the expected HTML at `/` and `/timeline`. The deployed entry, old Gantt chunk/CSS and calendar chunk also returned 200 with the expected content types. An unauthenticated Worker timeline request correctly returned 401. No app-side Timeline document navigation was found. The service worker does not intercept calendar API or script requests. The reported 400 could not be reproduced; its root cause remains unconfirmed. Removing the old chart and adding an error boundary are improvements, not proof that this full-page response is fixed.

## Verification

`npm run check` passed: 83 Worker/D1 integration tests, 67 Vue tests and 21 client/assets tests (171 total), strict type checks, Worker build and frontend build. Read-only requests to the running local session, Ideas, daily calendar and 42-day month range all returned 200. No migration or hosted task mutation was needed.

Coverage includes real FullCalendar Day/Week/Month initialization, safe title rendering, selection intervals across daylight-saving changes, resize/drop callbacks, stale-version rollback, serialized writes, access failures, draft retention, backdrop hit testing, calendar error containment/retry, independent idea saving and the user guide. The browser tool failed during initialization, so physical touch/drag gestures and visual alignment have not been verified in a real browser during this session. Google sign-in itself has not been retested interactively.
