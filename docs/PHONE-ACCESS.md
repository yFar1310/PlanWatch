# Phone access and private hosting

Implemented and checked on 19 October 2026. This milestone adds the installable-app files, connection/session handling, a private authentication path, and verified local backup tooling. Actual phone installation and hosted sign-in remain separate acceptance checks.

## Authentication

Local development retains the loopback-only bypass with `LOCAL_DEV=true`. Public hostnames cannot use it. Hosted APIs require all of:

- `ACCESS_TEAM_DOMAIN`: the team hostname, such as `your-team.cloudflareaccess.com`, without `https://`.
- `ACCESS_AUD`: the Access application's audience tag.
- `OWNER_EMAIL`: the one email address allowed to use the personal workspace.
- A valid `Cf-Access-Jwt-Assertion` verified with the team's public keys, RS256, the expected issuer/audience, required subject/email/issued/expiry claims, and the allowed email. Hosted writes also require the matching Origin.

Identity headers and arbitrary cookies are not treated as verified sessions. The API returns a sign-in error for missing/invalid/expired tokens and a generic temporary error if key verification is unavailable. It never logs tokens. `GET /api/session` returns the verified mode and expiry; API responses are private/no-store.

The hosted owner ID is the stable single-person workspace `personal`. Local records remain under `local-preview`; neither v1 data nor local prototype data is automatically copied to the hosted workspace.

The application verifies Access tokens itself because Cloudflare's current Static Assets router does not forward `ctx.access` into the user Worker. References: [Access identity and router limitations](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#ctxaccess-limitations), [token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Hosted preview setup

The intended preview uses Worker `planwatch-v2-preview` and its own D1 database. The local development binding stays separate. Copy `wrangler.preview.example.jsonc` to the ignored `wrangler.preview.jsonc`, then fill in the account ID, dedicated preview D1 ID, and Access settings. Account-specific email/configuration is not committed.

Build and apply the new database's migrations before deployment:

```sh
npm run check
npx wrangler d1 migrations apply DB --remote --config wrangler.preview.jsonc
npx wrangler deploy --config wrangler.preview.jsonc
```

The configuration disables version preview URLs. Never replace an existing unrelated Worker/database or apply development SQL to a personal database. The preview starts with an empty workspace; personal-data migration needs its own reviewed import and recovery check.

Wrangler login was verified. Its OAuth permissions permit Workers/D1 operations, but this account's Access-organization/application API requests returned HTTP 403. The Access setup therefore needs the dashboard or separately authorized Access permissions; a Google password or global API key is not needed.

For dashboard setup, open **Workers & Pages → planwatch-v2-preview → Access → Protect this Worker behind Access**, choose **All traffic**, and restrict the policy to the intended owner. If prompted to initialize Zero Trust, select the Free option; do not upgrade billing. Review the Access application's audience tag and team domain, then put them in the ignored preview config with the allowed email. See [Cloudflare's setup instructions](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

For platform installers that fetch icons/metadata without a login cookie, the manifest, `/icons/*`, `/sw.js`, and `/offline` contain only public assets. If the device installer cannot retrieve these behind Access, configure narrowly scoped public asset paths while keeping the app and every `/api/*` route protected. The API always verifies its token even if an alternate URL is reachable.

## Installation, offline behavior, and updates

`manifest.webmanifest` provides a stable app identity, standalone display, and real 192/512px icons, with a 180px Apple icon. The Install control uses the browser prompt when available and shows platform instructions otherwise. On iPhone/iPad, open Safari's Share menu and choose Add to Home Screen. Installation requires HTTPS or a supported loopback development origin. See [MDN install requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

The service worker registers only in production builds. It caches the public offline screen/icons, rejects login redirects or unexpected HTML during preparation, and never caches task/session/API responses or the authenticated app document. The offline URL is `/offline` because Cloudflare canonicalizes `/offline.html` with a redirect. Private records are loaded from the server when connected; reopening the app offline shows a reconnect screen, not a stale task database.

An already-open app can retain local drafts while offline. Save actions wait for connectivity and an authenticated session. The app rechecks the session when restored from the browser's back/forward cache, hides private records when the session expires, and preserves drafts. App updates require an explicit reload action rather than interrupting editing. No background/offline write queue is implemented.

## Local backup and verified restore

```sh
npm run db:backup:local
npm run db:verify-backup -- /absolute/path/to/.wrangler/backups/planwatch-....sql
```

Backup SQL and its SHA-256/size manifest are private, ignored local files. Verification validates the checksum, restores into a new isolated configuration/database, compares an exact re-export, runs D1's supported `quick_check` and `foreign_key_check`, checks required triggers, and exercises creation/history, dependency-cycle rejection, and deletion/unlinking. It does not restore over the working database. Each verification copy remains under `.wrangler/restore-checks/` for inspection.

An actual backup/restore passed locally, preserving the source export and checking task/history behavior in the restored copy. Hosted D1 recovery still needs an end-to-end drill before personal data is imported. D1 Time Travel retention depends on the account plan; consult [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) before making a hosted recovery plan. [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/) and [supported checks](https://developers.cloudflare.com/d1/sql-api/sql-statements/) describe the underlying commands.

## Verification and remaining acceptance checks

Type checks, both builds, 40 Workers integration tests, and 13 client/service-worker/asset tests pass. Coverage includes real RSA token signatures, forged/missing/expired/wrong-issuer/wrong-audience tokens, wrong owners, hosted Origin checks, separate local/hosted ownership, key-service failure, login redirects, unconfirmed writes, cache isolation, update activation, and PNG dimensions. Local production-preview HTTP checks cover the session/health endpoints and installation assets/headers.

The browser connection provided to this session still fails during setup. These automated and HTTP checks do not establish real phone installation, interactive sign-in, session renewal/logout, accessibility, keyboard behavior, service-worker lifecycle in a browser, or hosted CPU/cost suitability. Complete those checks and a hosted backup/restore plus deployment rollback before treating phone access as released. No AI, R2, email delivery, scheduling, or paid plan upgrade is enabled here.
