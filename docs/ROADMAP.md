# PlanWatch roadmap

Updated 19 October 2026. This is the implementation order and completion checklist, not a promise that all planned features are already built.

## Product objective

A readable, dependable personal task app that works on desktop and phone. It connects tasks to goals, shows dependencies, and produces a Sunday-evening PDF review with evidence-based AI advice aligned with the user's philosophy.

Delivery priorities: reliable task actions → effortless daily use → phone access → meaningful tracking and graph → AI → scheduled reports. Daily task management must keep working when AI, graph synchronization, or email is unavailable.

## Current position

The original app runs locally at http://localhost:5173. The first reliability increment is implemented: transactional task/outbox writes, retryable MongoDB publishing, field clearing, dependency validation including competing edits, explicit statuses, safer delete/load feedback, and opt-in demo seeding. Thirteen regression scenarios, backend typecheck/build, and frontend production build passed. Existing login and tasks were checked after restart.

Browser interaction and phone verification are still outstanding. The original UI remains largely in place. Cloudflare/D1 migration, PWA installation, the new graph views, Workers AI, and scheduled PDF email are not implemented. Current changes are local and uncommitted. The selected hosting direction is now full Cloudflare; D1 replaces the previously proposed PostgreSQL/MongoDB/Neo4j production combination while preserving task, history, and graph capabilities.

## Architecture to work toward

| Layer | Role |
|---|---|
| Vue + Tailwind | Today, Tasks, Map, Insights, task details, settings |
| Hono on Cloudflare Workers | Authenticated API and frontend delivery |
| Cloudflare D1 | Authoritative tasks, goals, sessions, report metadata, detailed JSON activity records, and graph node/relationship tables |
| Workers AI | Goal-aware prioritization and weekly interpretation |
| Workflows + scheduled trigger | Durable report execution and retries |
| R2 | Private PDFs with authorized access |
| Email Service | Report delivery to the configured verified recipient |
| Durable Objects | Add where demonstrated useful for coordination, reminders, live timers, or connection management |

Task changes and their activity records must remain atomic in D1. Rework the PostgreSQL transaction/locking implementation for D1 rather than assuming API compatibility. Store relationships in D1 and perform graph analysis in SQL/application code; Cypher and the Neo4j engine are outside the Cloudflare-only target. Task saves remain independent of AI and email. The Workers port replaces the Node timer publisher with durable scheduled/queue/workflow handling where needed. Docker remains a temporary migration and rollback environment; final local development uses Wrangler/Vite without containers.

## Phase 1 — Lock the platform and budget

Work:

- Treat the existing $20 ChatGPT subscription as the total ceiling unless the user changes that constraint: no additional paid service is enabled automatically.
- Inventory Cloudflare access, domain/email requirements, and D1/R2/Workers resources. Verify actual allowances, availability, and account-wide usage before deployment.
- Select a Workers AI model eligible for free usage; keep paid models, paid fallback, prepaid credits, and automatic upgrades disabled.
- Make a small local Workers proof: Hono request, local D1 persistence and atomic writes, cycle validation under concurrency, AI binding configuration, and PDF-rendering compatibility. Do not call an external model or deploy resources without configured access and an explicit cost policy.
- Export PostgreSQL tasks/accounts and MongoDB events into a portable format; preserve IDs, ownership, timestamps, nullable values, and history. Convert schema/types/queries for D1 and compare migrated records and behavior before cutover. Keep the working Node/Docker setup and existing volumes for rollback until migration and backups are verified.

Complete when: the target stack works in a local proof and there is a resource-by-resource budget plan. If the full hosted stack cannot meet the spending constraint, resolve the hosting tradeoff before making paid commitments.

## Phase 2 — Finish the daily task model and reliability

Work:

- Support title-first tasks with optional dates and estimates. Distinguish an intended work day from a hard deadline; support date-only and timed deadlines without timezone surprises.
- Add real completion timestamps, updated/version metadata, archive/Trash, and documented undo/restore behavior for dependency links.
- Implement validated search, status/date filters, stable pagination, and complete dependency lookup beyond the current 200-task page.
- Fix activity cursors and statistics types, scope legacy records to their owners, and use one user timezone for Today/Overdue/statistics.
- Protect repeated creates after lost responses with idempotency and protect stale phone/desktop edits with a recoverable conflict response.
- Add versioned D1 migrations and focused regression tests; preserve existing data during upgrades and port the existing reliability tests to the Workers runtime. Complete account/session hardening before publishing.

Complete when: create, edit, clear, complete, reopen, reschedule, delete, restore, and find tasks behave consistently after refresh; invalid graphs cannot be saved; failure/retry and ownership tests pass.

## Phase 3 — Build the everyday UI and UX

Work:

- Introduce shared colors, type sizes, spacing, controls, feedback, accessible labels, and focus states. Keep the purple identity and light/dark themes; default to a quiet static background.
- Use desktop sidebar and mobile bottom navigation: Today / Tasks / Map / Insights, with one consistently reachable Add task action.
- Build Today around overdue and today's tasks, quick add, completion controls, and a small workload summary.
- Share task rows/cards and a task form across list, board, and details. Use a desktop drawer and mobile sheet to retain context.
- Add date shortcuts, search/filter controls, clear save/error states, draft preservation, deletion recovery, and brief success feedback instead of routine success modals.
- Keep existing map functionality accessible while its replacement is developed. AI is not required for ordinary actions.

Complete when: desktop and phone users can add a basic task quickly, complete it directly, edit/reschedule it without losing context, and recover from mistakes or connection errors. Verify keyboard access, both themes, narrow screens, long titles, empty lists, and realistic task volumes.

**Milestone A: useful local daily planner.**

## Phase 4 — Move to Cloudflare and make phone access dependable

Work:

- Separate runtime entrypoints, environment bindings, database access, and migration execution. Port Hono without changing the task API unnecessarily.
- Serve the Vue build and API on one origin, configure secrets and sessions, and replace process-lifetime assumptions with durable background handling.
- Verify D1/R2 bindings, persistence, and failure behavior in the deployed preview. Add request/error monitoring and visible background-job state. Retire Docker as a development requirement after cutover checks pass, retaining portable exports and rollback instructions.
- Add PWA manifest/icons, standalone layout, HTTPS, safe areas, an update flow, connection status, and preserved drafts. Keep offline write synchronization outside this first PWA release.
- Set up backups and test restoration. Keep a rollback path and validate a preview before publishing personal data.

Complete when: the app works from the user's real phone while the development laptop is off, reopening/refreshing retains data, installation works on the target device, and backup restoration has been demonstrated.

**Milestone B: personal web app ready for everyday use on phone and desktop.**

## Phase 5 — Add goals, lightweight tracking, and graph views

Work:

- Add an editable philosophy profile: goals, life areas, priorities, non-negotiables, available capacity, and preferred coaching style.
- Add optional work sessions/time entries and a short daily reflection. Capture completion/rescheduling/deletion history with meaningful snapshots; do not infer actual effort from deadlines alone.
- Store nodes and relationships for tasks, projects, goals, and dependencies in D1, preserving stable IDs and owner scope. Add graph traversal and cycle validation in SQL/application logic.
- Keep graph reads consistent with authoritative task changes; validate query performance at representative personal-use sizes. Derived caches must be rebuildable from D1 data.
- Rework the map: readable nodes, tap-to-detail, search, fit/fullscreen, focused chains, goal/dependency views, and a phone-friendly text alternative.
- Keep critical-path details available as an advanced view. Label assumptions and unknown estimates; do not present dependency duration as a realistic personal calendar schedule.

Complete when: task/goal changes appear correctly in the map, graph computations pass correctness tests and remain responsive with representative data, and derived views can be rebuilt. Tracking must remain optional and quick enough for daily use.

## Phase 6 — Introduce Workers AI coaching

Work:

- Assemble a bounded evidence bundle from task data, activity history, graph relationships, and the user's current philosophy. Use controlled backend queries rather than unrestricted database access.
- Calculate facts in code, then ask AI to interpret them. Return structured recommendations with task references, explanations, uncertainty, and proposed actions.
- Add Help me prioritize, compare two tasks, and review workload. Let the user accept, adjust, or dismiss a suggestion.
- Test representative situations: competing worthwhile tasks, blocked tasks, unrealistic workload, insufficient evidence, and goals that explicitly protect rest and leisure.
- Keep tasks/notes as evidence rather than executable instructions. Restrict inference to intended personal data and keep credentials out of model input.
- Bound input/output, calls, and retries; save reusable results. If quota is unavailable, show a useful message and continue task management without paid fallback.

Complete when: recommendations follow the philosophy, cite real evidence, avoid invented facts, and pass a small repeatable evaluation set within the selected budget policy. Start with one provider/model configuration and add alternatives only if needed.

## Phase 7 — Automate the Sunday PDF and email

Work:

- Set a configurable Sunday-evening time in Europe/Paris; handle UTC scheduling and daylight-saving changes explicitly.
- Define the exact report cutoff and use a consistent evidence snapshot across stores. Detect delayed graph/event delivery and retry or disclose incomplete data.
- Implement a durable Workflow: collect → statistics → AI advice → render → private R2 storage → email → delivery status.
- Include goal allocation, planned/actual effort, completed/postponed work, blockers, and three concrete adjustments for the next week. Mark missing tracking honestly.
- Save report IDs, analysis results, and workflow checkpoints. Retry only the required stage and test duplicate prevention and ambiguous email responses.
- Add Insights history, download/retry controls, and an AI-unavailable fallback that still produces factual statistics. Render and visually inspect the PDF before accepting its layout.

Complete when: a scheduled end-to-end test produces a readable PDF, stores it privately, delivers it to the intended recipient, and handles AI/storage/email failures without losing work or repeating tested side effects.

**Milestone C: complete first version with personal AI coaching and weekly reports.**

## Phase 8 — Pilot and release

Use the app for at least one real week, including one Sunday report. Correct friction discovered through actual use before expanding the feature set.

Release checklist:

- [ ] Daily create/edit/complete/reopen/reschedule/delete/restore flows pass on phone and desktop.
- [ ] Search, pagination, statistics, map, and report totals agree under the documented date rules.
- [ ] Slow network, interrupted saves, expired sessions, stale edits, and unavailable analytics/AI/email have recoverable behavior.
- [ ] Light/dark themes, keyboard use, touch controls, long text, and large task histories are verified.
- [ ] PDFs are readable and private; report timing and retry behavior are verified.
- [ ] Backups have been restored; production startup does not seed/reset personal data.
- [ ] Tests/builds pass and deployment can be rolled back.
- [ ] Resource usage is measured against the agreed budget; no paid fallback is enabled silently.

## Later enhancements

Full offline writes and conflict resolution, recurring tasks, deeper habit tracking, multiple-predecessor scheduling if needed, advanced calendar planning, and richer push/reminder channels. These should not delay a dependable daily planner or the first weekly report.

## Next concrete action

Phase 1: validate the Cloudflare/Workers AI path and hosting budget locally. Then implement the Phase 2 task model that the new Today screen needs. Each phase should end with a working preview and its completion checks, rather than a large unverified rewrite.
