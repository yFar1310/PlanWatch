# Cloudflare deployment direction

Direction updated on 19 October 2026 to reflect the user's full-Cloudflare requirement. No Cloudflare resources, deployment, email deliveries, or paid services have been created. The running app still uses its original Docker/PostgreSQL/MongoDB environment until migration is validated.

## Recommended roles

- **Workers + Hono:** API and Vue static assets on the same origin.
- **D1:** primary database for tasks, goals, work sessions, structured JSON activity, and graph node/relationship tables. Use SQL/application traversal for graph features rather than a Neo4j service.
- **Workers AI:** initial AI provider using a free-eligible model, bounded usage, and no automatic paid fallback. Most app development runs locally; actual Workers AI inference uses Cloudflare resources and counts against its allowance.
- **R2 Standard:** private report PDFs; download through an authenticated endpoint or a short-lived authorized link.
- **Cron:** start the weekly report job. Cron uses UTC; determine the intended local Sunday slot in Europe/Paris and deduplicate by owner/week. Do not hardcode a year-round Paris UTC offset.
- **Workflows:** persist the multi-step report run, retry failed steps, and expose progress. Collect facts → AI analysis → render PDF → write R2 → send email. Use stable report IDs, saved AI outputs, and provider idempotency where supported to avoid repeated paid analysis and duplicate messages on ambiguous retries.
- **Durable Objects:** add for per-user coordination, reminders, active timer state, or live cross-device updates when required. They are not a prerequisite for a weekly Workflow and do not need to duplicate all D1 records.
- **Email Service:** Cloudflare supports sending to the account's verified destination addresses on Free or Paid. Arbitrary-recipient outbound sending requires Workers Paid. Domain/DNS configuration and recipient verification must be completed before enabling delivery.

## Existing databases

PostgreSQL and MongoDB are migration sources, not the final hosting target. Export and validate existing accounts, tasks, events, IDs, relationships, and timestamps before switching to D1. D1 uses SQLite semantics; PostgreSQL SQL dumps, types, transactions, and advisory locks cannot simply be reused unchanged.

Cloudflare supports connecting to externally hosted PostgreSQL through Hyperdrive. That is useful for a hybrid deployment, but full Cloudflare uses D1 here. The map and graph analysis remain product requirements; the specific PostgreSQL/MongoDB/Neo4j engines are replaced in the target design. Neo4j/Cypher would require revisiting this hosting constraint if they become engine-level requirements.

## Docker and local development

Docker currently provides a reproducible way to run the legacy API, frontend, PostgreSQL, and MongoDB. A web app can use Docker, but a Cloudflare-native Worker deployment does not require it. Use Wrangler or the Cloudflare Vite plugin and locally simulated D1/R2 resources for the final development workflow. Docker-compatible tooling is needed only if Cloudflare Containers are deliberately introduced; they are not part of this target. Keep existing database volumes and portable exports through migration verification and the rollback period.

## Porting work still required

The existing Node entrypoint uses a listening server, process-global DB clients, startup schema changes, and a timer-based outbox publisher. Workers need a fetch export, environment bindings, appropriate connection lifetimes, separate migrations, and durable background delivery through scheduled/queue/workflow handlers. Do not copy the Node setInterval publisher into a Worker and rely on it staying alive. Verify PDF rendering and all database drivers in the Workers runtime.

The step-1 domain validation and regression scenarios remain useful. Adapt transaction/event persistence, concurrency protection, runtime entrypoints, and background delivery to D1/Workers, preserving the same reliability guarantees through tests.

## Budget

Start with applicable Free allowances and measure resource use. Workers Paid starts at $5/month, separate from ChatGPT. R2 Standard includes 10 GB-month of storage and operation allowances. D1, AI, workflow, and object-storage quotas must be validated against actual use. Domain registration and paid Cloudflare usage are outside the ChatGPT subscription. Do not activate paid fallback automatically.

## Official references

- https://hono.dev/docs/getting-started/cloudflare-workers
- https://developers.cloudflare.com/workers/local-development/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/sql-api/query-json/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workflows/
- https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/
- https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/
- https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/
- https://neo4j.com/docs/query-api/current/
- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
