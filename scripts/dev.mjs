import { copyFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';

await mkdir('.wrangler/logs', { recursive: true });
try { await access('.dev.vars', constants.F_OK); }
catch { await copyFile('.dev.vars.example', '.dev.vars', constants.COPYFILE_EXCL); }

class Interrupted extends Error {}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    child.on('error', reject);
    let interrupted = false;
    const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => {
      const handler = () => { interrupted = true; child.kill(signal); };
      process.once(signal, handler);
      return [signal, handler];
    });
    child.on('exit', (code, signal) => {
      if (interrupted || ['SIGINT', 'SIGTERM', 'SIGHUP'].includes(signal) || [130, 143].includes(code)) reject(new Interrupted());
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
    child.once('exit', () => { for (const [signal, handler] of handlers) process.off(signal, handler); });
  });
}

try {
  await run('node_modules/.bin/wrangler', ['d1', 'migrations', 'apply', 'DB', '--local']);
  await run('node_modules/.bin/vite', process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Interrupted)) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
