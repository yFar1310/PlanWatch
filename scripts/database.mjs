import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// All database operations here are explicitly local. Verification always uses a new isolated path.
const root = fileURLToPath(new URL('../', import.meta.url));
const backups = resolve(root, '.wrangler/backups');
const sqlBytes = bytes => Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n').replace(/\n*$/, '\n'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
process.umask(0o077);
await mkdir(backups, { recursive: true, mode: 0o700 });

async function wrangler(args, allowFailure = false) {
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(resolve(root, 'node_modules/.bin/wrangler'), args, {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(root, '.wrangler/logs') },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolveResult({ code, stdout, stderr }));
  });
  if (result.code !== 0 && !allowFailure) {
    await writeFile(resolve(root, '.wrangler/last-database-error.log'), result.stdout + result.stderr, { mode: 0o600 });
    throw new Error(`Local database ${args[1]} failed. See .wrangler/last-database-error.log for details.`);
  }
  return result;
}
try {
  const [mode, input] = process.argv.slice(2);
  if (mode === 'backup') {
    const path = resolve(backups, `planwatch-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.sql`);
    await wrangler(['d1', 'export', 'DB', '--local', '--output', path]);
    await chmod(path, 0o600);
    const bytes = await readFile(path);
    await writeFile(`${path}.json`, JSON.stringify({ format: 1, createdAt: new Date().toISOString(), bytes: bytes.length, sha256: hash(bytes) }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Local backup created: ${path}\nVerify it with: npm run db:verify-backup -- ${path}`);
  } else if (mode === 'verify' && input) {
    const path = resolve(input);
    if (!path.startsWith(backups + sep) || !path.endsWith('.sql')) throw new Error('Place the backup SQL file in this project’s .wrangler/backups directory first.');
    const original = await readFile(path);
    const manifest = JSON.parse(await readFile(`${path}.json`, 'utf8'));
    if (manifest.format !== 1 || manifest.sha256 !== hash(original) || manifest.bytes !== original.length) throw new Error('Backup integrity check failed. The SQL file does not match its manifest.');
    const target = resolve(root, '.wrangler/restore-checks', randomUUID());
    await mkdir(target, { recursive: true, mode: 0o700 });
    // Export has no --persist-to option. A dedicated config makes every command use this copy.
    const config = resolve(target, 'wrangler.json');
    await writeFile(config, JSON.stringify({ name: 'planwatch-restore-check', compatibility_date: '2026-10-19', d1_databases: [{ binding: 'DB', database_name: 'restore-check', database_id: randomUUID() }] }), { mode: 0o600 });
    const inCopy = (operation, args, allowFailure = false) => wrangler(['d1', operation, 'DB', '--config', config, '--local', ...args], allowFailure);
    const query = async sql => {
      const result = await inCopy('execute', ['--json', '--command', sql]);
      return JSON.parse(result.stdout).flatMap(item => item.results ?? []);
    };
    await inCopy('execute', ['--file', path]);
    const roundtrip = resolve(target, 'roundtrip.sql');
    await inCopy('export', ['--output', roundtrip]);
    if (hash(sqlBytes(await readFile(roundtrip))) !== hash(sqlBytes(original))) throw new Error('The restored export differs from the original. This backup has not passed verification.');
    const integrity = await query('PRAGMA quick_check;');
    if (integrity.length !== 1 || integrity[0].quick_check !== 'ok' || (await query('PRAGMA foreign_key_check;')).length) throw new Error('Restored database integrity checks failed.');
    const triggers = await query("SELECT name FROM sqlite_schema WHERE type='trigger';");
    for (const name of ['tasks_validate_insert', 'tasks_validate_dependency', 'tasks_record_create', 'tasks_record_update', 'tasks_unlink_deleted_parent']) {
      if (!triggers.some(trigger => trigger.name === name)) throw new Error(`The backup is missing required trigger ${name}.`);
    }
    const counts = await query('SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM task_events) AS events;');
    const parent = randomUUID(), child = randomUUID();
    const insert = (id, dependency) => `INSERT INTO tasks (id,owner_id,title,status,depends_on,planned_date,created_at,updated_at,creation_key,creation_payload) VALUES ('${id}','restore-probe','Restore verification','todo',${dependency ? `'${dependency}'` : 'NULL'},'2026-10-19',1,1,'${randomUUID()}','{}');`;
    await query(insert(parent) + insert(child, parent));
    const loop = await inCopy('execute', ['--command', `UPDATE tasks SET depends_on='${child}' WHERE id='${parent}';`], true);
    if (loop.code === 0 || !(loop.stderr + loop.stdout).includes('dependency_cycle')) throw new Error('Restored dependency validation failed.');
    await query(`UPDATE tasks SET deleted_at=2,updated_at=2,version=version+1 WHERE id='${parent}';`);
    const unlinked = await query(`SELECT depends_on FROM tasks WHERE id='${child}';`);
    const history = await query(`SELECT task_id,kind FROM task_events WHERE task_id IN ('${parent}','${child}') ORDER BY id;`);
    if (unlinked[0]?.depends_on !== null || history.length !== 4 || !history.some(event => event.task_id === parent && event.kind === 'deleted') || !history.some(event => event.task_id === child && event.kind === 'updated')) throw new Error('Restored deletion/history behavior failed.');
    if (hash(await readFile(path)) !== manifest.sha256) throw new Error('The source backup changed during verification.');
    await writeFile(resolve(target, 'verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), sourceSha256: manifest.sha256, ...counts[0] }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Backup verified in an isolated local copy: ${counts[0].tasks} tasks, ${counts[0].events} activity events.\nSQL round trip (line endings normalized), integrity, foreign keys, dependency rejection, deletion, and history passed.\nThe working database was not changed. Verification copy: ${target}`);
  } else throw new Error('Use npm run db:backup:local or npm run db:verify-backup -- <backup.sql>.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
