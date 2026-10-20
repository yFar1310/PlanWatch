# Phone access and private hosting

Updated 20 October 2026. PlanWatch uses a Vue frontend on Cloudflare Pages, a separate Hono API Worker with D1, and Clerk Hobby for sign-in. Cloudflare Access was replaced at the owner's request. This authentication path does not require Zero Trust enrollment or a payment card.

## Authentication and ownership

The official Vue SDK displays sign-in and obtains a current session token for each API call. Requests use explicit Bearer headers; the client does not persist tokens itself, send cross-origin cookies, follow login redirects, or replay writes automatically. Account/session changes invalidate pending responses and unmount private content. Device-local drafts survive sign-out in workspace-scoped storage; private in-memory drafts are cleared. Short-lived tokens are renewed without interrupting editing.

The Worker verifies signatures using jose and the instance's public JWKS, cached per isolate with a bounded retrieval timeout. No Clerk secret key, per-request Clerk user lookup, paid feature, or custom email claim is needed. D1 holds workspace admission and observed activity sessions.

Hosted settings in ignored `wrangler.preview.jsonc`:

- `LOCAL_DEV=false`.
- `CLERK_ISSUER_URL`: the exact HTTPS Clerk Frontend API origin.
- `CLERK_OWNER_USER_ID`: the explicitly selected user ID; no first-user-wins enrollment.
- `APP_ORIGIN`: the exact permitted Pages frontend origin.
- `API_ORIGIN`: the exact Worker origin; defaults to APP_ORIGIN for a same-origin deployment.

Verification requires RS256, the expected issuer, version 2 claims, valid user/session IDs, issued/not-before/expiry timestamps, and azp equal to APP_ORIGIN. Pending and impersonated sessions are rejected. Active membership is checked in D1 after identity verification; the configured owner is the sole administrator. Cookies, old Access assertions, identity headers, API keys, and query-string tokens are not accepted. Tokens/provider errors are never logged.

The administrator’s hosted database owner remains `personal`; invited users receive separate UUID workspaces. See [private workspaces](PRIVATE-WORKSPACES.md). Changing login providers does not rename the administrator workspace. Loopback development with LOCAL_DEV=true retains a separate `local-preview` owner. That flag cannot bypass authentication on public hostnames. No v1 or prototype records are imported automatically.

Signature verification does not remotely revoke an issued JWT before expiry. The UI clears immediately on sign-out; server validity remains bounded by token lifetime. PlanWatch bans are checked against D1 on every request, independently of JWT expiry. Real-device renewal/sign-out checks remain open. References: [Vue SDK](https://clerk.com/docs/vue/getting-started/quickstart), [session claims](https://clerk.com/docs/guides/sessions/session-tokens), [verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification).

## Clerk setup and budget

Use **Hobby**, without adding a payment card or paid add-ons. Configure Google sign-in. PlanWatch uses its own invitation admission independently of Clerk registration. Keep Clerk sign-up available to invited friends; a new Clerk identity alone grants no task access. Clerk's paid production email Allowlist is not used. See [pricing](https://clerk.com/pricing) and [access restrictions](https://clerk.com/docs/guides/secure/restricting-access).

The supplied pk_test key belongs to a development instance. It supports preview testing, not production acceptance. Clerk production currently requires an owned domain, DNS configuration, and dedicated Google OAuth credentials. The owner does not yet have a PlanWatch domain; no domain purchase or paid upgrade is enabled. See [production prerequisites](https://clerk.com/docs/guides/development/deployment/production).

## Separate Pages frontend and API Worker

Dedicated preview targets:

- Frontend: https://planwatch-v2-preview.pages.dev
- API: https://planwatch-v2-preview.yahyafarehanmj.workers.dev/api
- Worker and D1 names: planwatch-v2-preview.
- Pages production branch: PlanWatch2.0, in this separate preview project.

The existing Pages project planwatch and v1 data are preserved. The dedicated D1 database uses numbered migrations. Migration 0003 adds invited workspaces and administration; 0004 adds priorities and prerequisite-completion checks.

Copy `.env.example` to an ignored environment file and set `VITE_CLERK_PUBLISHABLE_KEY`. Vue/Vite uses this prefix, not NEXT_PUBLIC_. Set `VITE_API_BASE_URL=https://YOUR_WORKER_HOSTNAME/api` in ignored `.env.production.local` for Pages builds; local development keeps /api. These are public build settings. Never put secrets in VITE_ variables.

The Worker allows CORS only for APP_ORIGIN, requires that Origin on hosted writes, and permits only necessary preflight methods/headers. Preflight never reads D1. Authentication errors retain CORS headers for the allowed frontend. CORS is additional browser protection; signatures and ownership protect every task/session request. API responses are private/no-store.

```sh
npm run check
npx wrangler deploy --dry-run --config wrangler.preview.jsonc --name planwatch-v2-preview
npx wrangler deploy --config wrangler.preview.jsonc --name planwatch-v2-preview
npm run deploy:pages
```

`wrangler.preview.example.jsonc` is the API-only template. The root `wrangler.jsonc` remains for local unified development. `pages/wrangler.jsonc` configures static assets. The Pages helper anchors its generated configuration lookup so Vite's local Worker redirect cannot substitute the local D1 binding. Only dist/client is uploaded, never dist/worker or .dev.vars.

Pages uses Direct Upload. The [GitHub Actions workflow](CI-CD.md) publishes after successful checks when its repository variable and Cloudflare token are configured. Current Wrangler delegates creation of new Pages projects to Workers by default; this project was explicitly created directly on Pages to honor the requested separation. See [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

Cloudflare acknowledged both deployments on 20 October 2026: API Worker version `c62b43d4-6b54-453d-8dbf-7587394479e2` and Pages deployment `d262b26c` (11 uploaded static files). The supplied owner ID is pinned in the ignored API configuration.

Public HTTP responses and deployment results must be checked separately. Probes to both Pages and Worker hosts fail with TLS connection resets from this environment, including public assets and other pre-existing Pages projects. The owner confirmed the preview opens over cellular data and that the reset occurs on the school Wi-Fi. The owner also reached the task capture interface; an actual task creation/refresh round trip has not yet been confirmed. The local API responds successfully and the Clerk public JWKS endpoint returned HTTP 200.

## Installation and offline behavior

The manifest supplies a stable standalone identity, 192/512px icons, and a 180px Apple icon. The Install control uses the browser prompt or explains its installation menu. On iPhone/iPad, use Safari Share → Add to Home Screen. See [install requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

The production service worker caches only /offline and public icons, rejecting redirects/unexpected HTML. It never caches task/session/API data, Clerk requests, or app HTML. Cross-origin API requests bypass it. Reopening offline shows a reconnect screen. An open app retains drafts; saves need connectivity and verified sign-in. Updates require explicit reload. Full offline synchronization is not implemented.

Drafts remain on the device after sign-out and are not encrypted. Use a trusted personal device. Real phone installation, redirects, and session behavior need separate checks.

## Backup and recovery

```sh
npm run db:backup:local
npm run db:verify-backup -- /absolute/path/to/.wrangler/backups/planwatch-....sql
```

Backups and checksum/size manifests are private ignored files. Verification restores into an isolated copy, compares a re-export with line endings normalized, runs D1 quick_check/foreign_key_check, checks triggers, and tests history, cycles, and deletion/unlinking. An actual local restore passed without overwriting the working database. Before migrations 0003/0004, a remote export containing 3 tasks and 10 events passed the isolated local restore checks; destructive remote restore and rollback remain untested. See [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/) and [export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Verification and acceptance

Type checks, both builds, **the Workers integration, Vue component, and client/service-worker/asset/deployment suites pass**. Coverage includes RSA signatures, invalid/expired/future/wrong-issuer/wrong-origin tokens, other users, pending/impersonated sessions, Origin/CORS/preflight checks, workspace isolation, invitation admission, administration, bans, usage estimates, key outages, renewal, delayed responses, sign-out failures, draft retention, cache isolation, and icons.

Component tests use jsdom with mocked Clerk state; they do not verify actual Google OAuth or browser rendering. The browser tool remains unavailable during setup. Real-device sign-in/renewal/logout, installation, accessibility/visual review, hosted CPU/cost measurements, recovery, and rollback remain open. AI, R2, reports, email sending, and paid upgrades are not activated.
