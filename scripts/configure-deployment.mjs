import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function parsePreviewConfig(input) {
  let config;
  try { config = JSON.parse(input); } catch { throw new Error('Set the PLANWATCH_PREVIEW_CONFIG repository variable to the prepared JSON configuration.'); }
  for (const field of ['accountId', 'databaseId', 'clerkPublishableKey', 'clerkOwnerUserId', 'appOrigin', 'apiOrigin']) {
    if (typeof config?.[field] !== 'string' || !config[field]) throw new Error(`Missing deployment field: ${field}`);
  }
  if (!/^[a-f0-9]{32}$/.test(config.accountId) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.databaseId) || config.databaseId === '00000000-0000-0000-0000-000000000000') throw new Error('Use the dedicated Cloudflare account and preview database IDs.');
  if (!/^user_[a-zA-Z0-9]+$/.test(config.clerkOwnerUserId)) throw new Error('Set the explicitly allowed Clerk owner user ID.');
  const encoded = config.clerkPublishableKey.match(/^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/)?.[1];
  const hostname = encoded ? Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '') : '';
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(hostname)) throw new Error('Use a valid Clerk publishable key, never a secret key.');
  for (const field of ['appOrigin', 'apiOrigin']) {
    const url = new URL(config[field]);
    if (url.protocol !== 'https:' || url.username || url.password || url.href !== `${url.origin}/`) throw new Error(`${field} must be an HTTPS origin without a path.`);
    config[field] = url.origin;
  }
  if (config.appOrigin !== 'https://planwatch-v2-preview.pages.dev') throw new Error('This workflow deploys only the dedicated PlanWatch 2.0 preview.');
  return { ...config, clerkIssuer: `https://${hostname}` };
}

export async function configureDeployment(input, root) {
  const config = parsePreviewConfig(input);
  const worker = {
    $schema: './node_modules/wrangler/config-schema.json', name: 'planwatch-v2-preview',
    account_id: config.accountId, main: 'worker/index.ts', compatibility_date: '2026-10-19',
    workers_dev: true, preview_urls: false,
    vars: { LOCAL_DEV: 'false', CLERK_ISSUER_URL: config.clerkIssuer, CLERK_OWNER_USER_ID: config.clerkOwnerUserId, APP_ORIGIN: config.appOrigin, API_ORIGIN: config.apiOrigin },
    d1_databases: [{ binding: 'DB', database_name: 'planwatch-v2-preview', database_id: config.databaseId, migrations_dir: 'migrations' }],
  };
  await writeFile(resolve(root, 'wrangler.preview.jsonc'), JSON.stringify(worker, null, 2) + '\n', { mode: 0o600 });
  await writeFile(resolve(root, '.env.production.local'), `VITE_CLERK_PUBLISHABLE_KEY=${config.clerkPublishableKey}\nVITE_API_BASE_URL=${config.apiOrigin}/api\n`, { mode: 0o600 });
  await mkdir(resolve(root, '.wrangler'), { recursive: true });
  await writeFile(resolve(root, '.wrangler/preview-origins.json'), JSON.stringify({ appOrigin: config.appOrigin, apiOrigin: config.apiOrigin }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await configureDeployment(process.env.PLANWATCH_PREVIEW_CONFIG ?? '', fileURLToPath(new URL('../', import.meta.url)));
    console.log('Prepared the dedicated Pages/Worker preview configuration. LOCAL_DEV=false; no secrets written to the frontend.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
