import { copyFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';

await mkdir('.wrangler/logs', { recursive: true });
try { await access('.dev.vars', constants.F_OK); }
catch { await copyFile('.dev.vars.example', '.dev.vars', constants.COPYFILE_EXCL); }

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 || signal === 'SIGINT' ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
    const forward = () => child.kill('SIGINT');
    process.once('SIGINT', forward);
    child.once('exit', () => process.off('SIGINT', forward));
  });
}

await run('node_modules/.bin/wrangler', ['d1', 'migrations', 'apply', 'DB', '--local']);
await run('node_modules/.bin/vite', process.argv.slice(2));
