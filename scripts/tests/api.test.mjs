import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = await readFile(new URL('../../src/api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client(reply) {
  const calls = [];
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, JSON, AbortSignal, fetch: async (...args) => { calls.push(args); return reply(...args); } });
  return { ...exports, calls };
}
test('API requests send same-origin credentials, disable caches, and never follow login redirects', async () => {
  const app = client(() => new Response('{"items":[]}', { headers: { 'Content-Type': 'application/json' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(await app.api('/tasks'))), { items: [] });
  assert.equal(app.calls[0][1].credentials, 'same-origin');
  assert.equal(app.calls[0][1].cache, 'no-store');
  assert.equal(app.calls[0][1].redirect, 'manual');
});
test('Access redirects and login HTML become sign-in errors, never task data', async () => {
  for (const response of [new Response('', { status: 302 }), new Response('<h1>Sign in</h1>', { headers: { 'Content-Type': 'text/html' } }), { type: 'opaqueredirect', status: 0 }]) {
    const app = client(() => response);
    await assert.rejects(app.api('/tasks'), error => error.status === 401);
  }
});
test('API authorization failures retain the actionable server message', async () => {
  const app = client(() => new Response('{"error":"sign_in_required","message":"Sign in again."}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(app.api('/session'), error => error.status === 401 && error.message === 'Sign in again.');
});
test('non-JSON login and access-denied responses remain actionable authorization errors', async () => {
  for (const status of [401, 403]) {
    const app = client(() => new Response('Access denied', { status, headers: { 'Content-Type': 'text/plain' } }));
    await assert.rejects(app.api('/session'), error => error.status === status && /Sign in/i.test(error.message));
  }
});
test('an interrupted write is reported as unconfirmed instead of a successful or automatically replayed save', async () => {
  const app = client(() => { throw new TypeError('Network failed'); });
  await assert.rejects(app.api('/tasks', 'POST', { title: 'Draft stays here' }, 'test-key'), /Could not confirm this change/);
  assert.equal(app.calls.length, 1);
});
test('unreadable success responses are rejected before the UI uses them', async () => {
  for (const body of ['null', '[]', 'not JSON']) {
    const app = client(() => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(app.api('/tasks'), error => error.status === 502);
  }
});
