import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = resolve(root, 'pages');
await access(resolve(root, 'dist/client/index.html'));
const apiConfig = JSON.parse(await readFile(resolve(root, 'wrangler.preview.jsonc'), 'utf8'));
if (!/^[a-f0-9]{32}$/.test(apiConfig.account_id)) throw new Error('Configure the dedicated Cloudflare account before uploading Pages assets.');
// Anchor Pages' config lookup here instead of inheriting Vite's local Worker build redirect.
await mkdir(resolve(pages, '.wrangler/deploy'), { recursive: true });
await writeFile(resolve(pages, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../wrangler.jsonc' }) + '\n');
const child = spawn(resolve(root, 'node_modules/.bin/wrangler'), [
  'pages', 'deploy', '../dist/client', '--project-name', 'planwatch-v2-preview', '--branch', 'PlanWatch2.0', '--commit-dirty=true',
], { cwd: pages, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: apiConfig.account_id } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
