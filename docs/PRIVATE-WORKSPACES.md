# Invited workspaces and administration

Implemented on the PlanWatch2.0 branch, 20 October 2026. Vue remains on Pages, the API on a Worker, and task/workspace data in D1. There is no additional service or paid Clerk Organizations feature.

## Admission and isolation

Clerk verifies identity; PlanWatch decides admission. The configured `CLERK_OWNER_USER_ID` alone bootstraps the existing `personal` workspace and receives administration privileges. It is never assigned to the first person who signs in. Existing hosted tasks and history keep their owner IDs. Local development keeps `local-preview`, without administration.

A different verified Clerk user must accept an administrator-generated invitation before receiving a workspace with a new UUID. Each task query/mutation uses this server-resolved workspace, including search, Trash, dependencies and idempotency keys. Task cursors also include the workspace and filter scope. Client owner fields and role claims cannot select a workspace or grant administration.

People may reach Clerk sign-in or create a Clerk identity without being admitted to PlanWatch. A PlanWatch invitation is not a Clerk invitation. Keep Clerk registration available for invited friends, or separately configure their admission in Clerk if registration there has been restricted.

## Invitations

Administration is visible only after the API returns `canAdmin=true`; API routes independently enforce the same role. An invitation has a label, a 256-bit random code, a seven-day expiry, and a single redemption. D1 stores only its SHA-256 hash. The raw link is returned once and can be copied manually; there is no email sending. At most 20 unused/unexpired invitations may exist. Active links appear first in the last 50 invitation records.

The code is in the URL fragment, which is not sent in HTTP requests. Before Clerk initialization, the frontend moves it to sessionStorage and clears it from the address. This allows a sign-in redirect/refresh without losing it. Redemption requires a display name and explicit acknowledgment of the usage statistics. Redemption and workspace creation run in one D1 transaction; failed creation does not consume the code. A signed-in member keeps their existing space rather than consuming another invitation.

Revocation stops an unused link. A banned member cannot accept a fresh link to bypass the ban. Shared links are bearer invitations: the first eligible signed-in person to redeem one receives access. Share them only with the intended recipient.

## Monitoring and bans

The dashboard lists display names, workspace references, admission/access status, last observed activity, observed Clerk sessions, estimated active time, total tasks, and completed tasks. Task counts include Trash. It supports member search, access filtering and pagination. Task titles, notes, invitation hashes, JWTs and email addresses are not returned by this dashboard.

The application sends an activity heartbeat every 30 seconds, only after membership verification. The active flag requires a visible document and a keyboard/pointer interaction within the last minute. Visibility changes also update activity. The server adds at most 30 seconds when two active heartbeats are no more than 45 seconds apart. Hidden/idle intervals and longer gaps add no time. Client-supplied durations are rejected. Metrics start with this release; they cannot reconstruct earlier usage. Multiple tabs, closed tabs, dropped requests and background throttling make this an estimate, not exact login duration. There is no third-party analytics service.

Ban/reactivate changes use optimistic versions. Banning closes observed activity sessions and every subsequent API request checks the persisted member status, including requests made with a still-valid JWT. The UI clears private records and in-memory drafts when it receives the ban. The configured administrator cannot ban itself. Reactivation restores access to existing data; banning does not delete tasks or the Clerk account.

## Draft privacy

Drafts load only after the server verifies a workspace and use workspace-scoped localStorage keys. Sign-out/account changes clear in-memory drafts and invalidate late requests. Device storage retains each workspace's drafts for that workspace's next sign-in. Legacy unscoped drafts migrate only for the verified administrator or local preview. Drafts are not encrypted or synchronized between devices.

## Migration and recovery

`0003_private_workspaces.sql` adds membership, invitation and observed-session tables. `0004_task_priorities.sql` adds priority and updates future task snapshots. Existing snapshots remain intact. No existing task rows are reassigned or removed.

Before publishing these migrations, an actual remote SQL export was saved privately with a checksum and restored in an isolated local D1 copy. Verification passed for 3 tasks and 10 task events, SQL round trip with line endings normalized, integrity, foreign keys, existing triggers, dependency validation, deletion/unlinking and history. This verifies a remote export restored locally; a destructive remote restore/rollback has not been performed. Backup files are ignored, mode 0600, and never committed.

Deployment uses the existing GitHub Actions variable/secret; `CLERK_OWNER_USER_ID` now identifies the administrator. No configuration change or new secret is needed. CI applies numbered migrations before publishing Worker and Pages. There is no automatic destructive rollback.

Integration tests cover signed owner/member identities, unauthorized users, cross-workspace access, invitation expiry/revocation/replay/concurrent redemption/rollback, member pagination, administrator protections, bans/reactivation, and bounded activity counters. Component tests cover admission/disclosure, administration, draft isolation and private-view clearing. Actual multi-account Google OAuth, phone rendering/install behavior and hosted usage costs still need real-device acceptance.
