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

This is the clean starting point: application code and runnable development commands will be added in the first implementation milestone. See [the roadmap](docs/ROADMAP.md).

## Budget

No automatic paid upgrades or paid AI fallback. Validate resource use against the user's existing $20 total monthly ceiling before enabling hosted features. A ChatGPT subscription does not include Cloudflare service charges.
