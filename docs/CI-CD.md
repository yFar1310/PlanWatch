# GitHub Actions for the PlanWatch 2.0 preview

The workflow in `.github/workflows/planwatch-preview.yml` checks pushes and pull requests targeting `PlanWatch2.0`. It uses Node 24, `npm ci`, strict TypeScript checks, Workers and Vue tests, client/asset tests, and both builds. Pull requests cannot deploy or receive the Cloudflare token. The workflow has read-only repository permissions; deployment credentials are supplied only to the Cloudflare publish/migration steps.

Successful pushes can deploy the dedicated API Worker and Pages frontend, then check public assets, unauthenticated API rejection, CORS preflight, and rejection of other origins. Deployments are serialized. The original Pages project and repository `main` are not deployment targets. D1 changes use numbered migrations; no database is created, dropped, or replaced by this workflow.

## One-time GitHub settings

Two repository settings are needed at [Settings → Secrets and variables → Actions](https://github.com/yFar1310/PlanWatch/settings/secrets/actions):

1. Under **Variables**, add `PLANWATCH_PREVIEW_CONFIG`. Paste the entire prepared, ignored `.wrangler/github-preview-config.json` file, including its opening `{` and closing `}`. Preserve the JSON quotes and commas; do not wrap it in Markdown code fences or an extra pair of quotes. It contains public configuration only: account/database IDs, Clerk publishable key and owner ID, and frontend/API origins. No secret keys belong in this JSON.
2. Under **Secrets**, add `CLOUDFLARE_API_TOKEN`. Create a custom token in [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), restricted to the intended account, with **Workers Scripts: Edit**, **Cloudflare Pages: Edit**, and **D1: Edit** permissions. Paste the token directly into GitHub, never into chat or source files. A global API key and Clerk secret key are not needed. Revoke/replace the token in Cloudflare/GitHub if it is ever exposed.

The local Wrangler OAuth login is not a GitHub Actions credential. See [Cloudflare's CI authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

Until the public config variable exists, the verify job runs and deployment is skipped. If the variable exists but the secret is missing, deployment stops with an actionable message before publishing. After setting both, push the next change or use **Re-run all jobs** on the existing workflow run. Manual dispatch is also declared, but GitHub may require the workflow on the default branch before offering its Run workflow button; merging into `main` is not needed for push-triggered preview deployments.

The helper `npm run deploy:configure` validates the supplied settings and creates ignored API/frontend configuration. It derives the Clerk issuer from its publishable key, requires an explicitly pinned owner, rejects the local dummy database, and keeps LOCAL_DEV=false. The Pages helper gets its account ID from that configuration and uploads only `dist/client`.

## Pages dashboard and verification

**No Git connection** in the Pages dashboard is expected: this project uses Direct Upload, and GitHub Actions publishes through Wrangler. A native Pages Git connection is not needed. Only pushes to `PlanWatch2.0` publish this preview; pushing another branch does not replace it.

The deployment check verifies public HTTP behavior, not an authenticated task round trip. Real Google sign-in, task creation/refresh/deletion/restore, phone installation, hosted recovery, and budget measurements remain separate acceptance checks. The current Clerk key is for development; an owned domain and Clerk production configuration are still needed before release.

On 20 October 2026, the owner confirmed the Pages preview opens over cellular data while the school's Wi-Fi returns ERR_CONNECTION_RESET. The same reset affects other existing Pages sites from this execution environment. Do not redeploy or weaken authentication to work around that network restriction; use an authorized network for testing.

No paid plan, domain purchase, AI request, or report email service is activated by this workflow. GitHub Actions usage follows the repository's existing GitHub plan and billing settings; the workflow does not change them.
