# Foundation prototype

Validated locally on 19 October 2026. This is the first implementation milestone; no v1 data was imported and no hosted resources were created.

## Decisions supported by the prototype

Vue and Hono run together through Cloudflare's Vite plugin. The interface uses real API responses and D1 records. List requests are bounded to 50 records by default (maximum 100) with a timestamp/id cursor; indexes support owner-scoped listing and dependency lookups.

D1 task changes and their activity snapshots commit together using SQLite triggers. Failed snapshot writes roll back creation, edits, and deletion, including dependent-task updates. Dependency loops are rejected inside the write operation, including two simultaneous edits that would otherwise each appear valid. This avoids a separate database or Durable Object just to serialize those operations.

Each edit carries the version the editor originally opened. An outdated version returns a conflict instead of overwriting another save. Creation uses a request key so retrying the same request creates one task and one activity event. The UI keeps the request key after an ambiguous create failure and retains fields after failed saves. A conflict requires reviewing the latest record; an open draft does not silently acquire a newer version on refresh.

Deletion preserves the task and its snapshots. Dependents are unlinked in the same operation and receive their own version/activity changes. Restoring the parent restores its content, without silently reconnecting children. The prototype undo list lasts for the current page session; a searchable Trash view is still needed.

## Verification

`npm run check` covers strict type checks, 17 Workers-runtime integration tests, and both client and Worker builds. The tests cover:

- Loopback-only access, disabled-by-default APIs, and foreign-origin write rejection.
- Title-only capture, request replay, and ownership scoping.
- Atomic rollback of creation, edits, and a deletion that changes dependents.
- Clearing optional fields, explicit completion/reopening, and concurrent stale saves.
- Self/longer dependency loops and concurrent edits creating a loop.
- Soft deletion, repeated deletion, restoration, and history snapshots.
- Cursor pagination when timestamps tie and invalid request inputs.
- Creation and parsing of a one-page PDF inside the Workers runtime.

Local HTTP checks also verify that the app shell and health endpoint respond successfully and unknown API routes return JSON 404 responses rather than the application shell. A saved verification task survived a server restart; HTTP editing, completion, deletion, and restoration passed afterward. That verification task was soft-deleted after the check. Browser verification could not run because the provided browser connection failed during setup. Mobile appearance, focus after actions, contrast, and full click-through flows still require visual review. A responsive stylesheet is not evidence of a completed accessibility review.

These tests establish correctness at prototype scale. They do not establish production latency, long-term storage growth, large graph performance, or hosted CPU usage. Those remain deployment gates.

## Free-tier feasibility and remaining gates

The following published allowances were checked on 19 October 2026. They are planning inputs; no live account or billing settings were inspected.

| Service | Published free allowance relevant to this project | Remaining verification |
| --- | --- | --- |
| Workers | 100,000 requests/day; 10 ms CPU per invocation | Measure hosted task API CPU/latency before personal use. |
| D1 | 5 million rows read/day; 100,000 rows written/day; 500 MB per free database | Measure indexed query usage, trigger/index writes, and snapshot storage growth. |
| Workers AI | 10,000 neurons/day for eligible models | Select and evaluate a free-eligible model with bounded input/output and a usage cap. |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

The PDF library works inside the local runtime. That does **not** prove a realistic weekly report fits the free CPU limit. Measure a representative report in a controlled hosted test before choosing its final renderer and scheduling architecture. Do not enable a paid plan as a workaround without an explicit budget decision. R2, email delivery, scheduling, and AI have no bindings or implementation in this milestone; their eligibility, account activation requirements, quotas, and end-to-end behavior remain to be validated.

D1 is a reasonable candidate for the next milestone based on the local correctness results. Keep the managed PostgreSQL fallback open until hosted measurements, backups, and recovery pass. No claim that the complete eventual system will cost $0 has been established.

## Next implementation slice

The daily task experience is now implemented; see [daily-planning notes](DAILY-PLANNING.md) for the current checks and open browser-review gate. Authentication, hosted backups with a tested restore, and a deployment rollback come before connecting the app to personal daily data or enabling public access.
