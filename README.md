# PlanWatch 2.0

A fresh build of a personal task planner for everyday desktop and phone use.

This branch starts from a clean application tree. PlanWatch v1 is an inspiration for the product, not a codebase to extend. Its Git history is preserved.

## Repository branches

- `main`: the original PlanWatch project.
- `fix/task-reliability`: the verified reliability corrections to v1, its tests, and the earlier review/roadmap.
- `PlanWatch2.0`: the new implementation, developed independently in this checkout.

The original app and database volumes remain available in the original checkout. No personal data has been deleted or migrated.

## Product goals

- Add, complete, edit, reschedule, and recover tasks with very little effort.
- Read a calm Today screen and a clear task/goal dependency map.
- Use the app on a phone as an installable web app.
- Connect work to personal goals and an editable life philosophy.
- Receive optional evidence-based AI advice and a Sunday-evening PDF review.
- Keep task management usable when AI or report delivery is unavailable.

## Technical direction

Cloudflare-first: Vue, TypeScript, Hono, Workers, and a D1 feasibility prototype. R2, Workers AI, scheduled Workflows, email, and Durable Objects are added only as their features are implemented. The database choice must pass the reliability and budget checks before any data migration; managed PostgreSQL remains the fallback if required.

The target development workflow uses Wrangler/Vite. Docker is not a requirement for the new implementation. No cloud resources, paid plans, AI requests, or email deliveries have been enabled by creating this branch.

## Run locally

Use Node.js 22.12+ (Node 24 recommended):

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5174. The dev command creates an ignored `.dev.vars` from the example, applies local D1 migrations, and starts Vue and the API together. No Cloudflare login or Docker is needed. Stop with Ctrl+C.

If that port is already in use, run `npm run dev -- --port 5175`. Use a single development server against the local database for normal use.

Tasks persist under `.wrangler/state/` in this checkout; do not delete that directory to restart the app. This database is separate from v1. Use `npm run db:backup:local` for a private SQL backup, then the printed verification command to test restoration in an isolated copy. Hosted recovery still needs its own verification.

## Current prototype

- Today opens by default with open work planned for today or earlier, using Europe/Paris calendar days.
- Title-only task capture, optional planned days, Today/Tomorrow/No date shortcuts, editable notes and time estimates, explicit status/completion, and actual time spent.
- Tasks with Open/Done/All filters and database search across titles and notes, including records beyond the loaded page.
- Durable Trash with search and restoration after refresh, plus undo for the last deletion. Trash is ordered by deletion time.
- A sun/moon button switches directly between light and dark, with the choice saved on this device and applied before the first app render. The initial appearance follows the system until a choice is made.
- Capture and task-edit drafts survive refresh in browser storage when available. Save conflicts retain drafts and offer an explicit choice to use the saved version.
- Real D1 persistence, full activity snapshots, duplicate-create protection, and stale-edit checks.
- Dependency validation in the API/database; the relationship editor and map come later.
- Responsive interface with labeled controls, keyboard focus states, and reduced-motion support. Browser visual and interaction review is still pending.
- Install manifest, home-screen icons, safe-area layouts, installation guidance, and an offline screen. Private task/session responses are never cached by the service worker.
- Connection/session feedback, disabled saves while offline or signed out, and an explicit action for app updates.
- A Cloudflare Access authentication path with signed-token verification and a single allowed owner. Hosted setup stays closed until configured.

Local API access requires both a loopback hostname and the local development flag. Hosted API access requires a verified Cloudflare Access token for the configured team, application, and owner email. The committed development configuration disables public access. See [phone access and hosting](docs/PHONE-ACCESS.md) for configuration, recovery, and remaining real-device checks. Goals/map, AI coaching, and scheduled reports follow [the roadmap](docs/ROADMAP.md).

## Verify

```sh
npm run check
```

Runs strict TypeScript checks, 40 integration tests in the Workers runtime, 13 API-client/service-worker/asset checks, and the production build. Tests use isolated databases and do not change the persistent development database. The PDF probe tests runtime compatibility, not a finished report template or free-tier CPU suitability. See [foundation findings](docs/FOUNDATION.md) and [daily-planning notes](docs/DAILY-PLANNING.md).

Use new numbered SQL migrations for schema changes after this baseline; do not edit an already-applied migration.

## Budget

No automatic paid upgrades or paid AI fallback. Validate resource use against the user's existing $20 total monthly ceiling before enabling hosted features. A ChatGPT subscription does not include Cloudflare service charges.
