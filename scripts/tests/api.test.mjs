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
  vm.runInNewContext(compiled, { exports, Error, JSON, URL, AbortSignal, fetch: async (...args) => { calls.push(args); return reply(...args); } });
  return { ...exports, calls };
}
test('API requests send same-origin credentials, disable caches, and never follow login redirects', async () => {
  const app = client(() => new Response('{"items":[]}', { headers: { 'Content-Type': 'application/json' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(await app.api('/tasks'))), { items: [] });
  assert.equal(app.calls[0][1].credentials, 'same-origin');
  assert.equal(app.calls[0][1].cache, 'no-store');
  assert.equal(app.calls[0][1].redirect, 'manual');
});
test('a Pages frontend sends its bearer to the configured HTTPS Worker without cookies', async () => {
  const app = client(() => new Response('{"items":[]}', { headers: { 'Content-Type': 'application/json' } }));
  app.setApiBaseUrl('https://planwatch-api.example/api');
  app.setAuthTokenProvider(async () => 'clerk-session');
  await app.api('/tasks');
  assert.equal(app.calls[0][0], 'https://planwatch-api.example/api/tasks');
  assert.equal(app.calls[0][1].credentials, 'omit');
  assert.equal(app.calls[0][1].headers.Authorization, 'Bearer clerk-session');
  for (const invalid of ['http://unsafe.example/api', 'https://api.example/other', 'https://user:password@api.example/api', 'https://api.example/api?redirect=1']) {
    assert.throws(() => app.setApiBaseUrl(invalid));
  }
});
test('login redirects and login HTML become sign-in errors, never task data', async () => {
  for (const response of [new Response('', { status: 302 }), new Response('<h1>Sign in</h1>', { headers: { 'Content-Type': 'text/html' } }), { type: 'opaqueredirect', status: 0 }]) {
    const app = client(() => response);
    await assert.rejects(app.api('/tasks'), error => error.status === 401);
  }
});
test('each API call obtains the current Clerk token without persisting or replaying it', async () => {
  const app = client(() => new Response('{"items":[]}', { headers: { 'Content-Type': 'application/json' } }));
  let issued = 0;
  app.setAuthTokenProvider(async () => `session-${++issued}`);
  await app.api('/tasks');
  await app.api('/tasks');
  assert.equal(app.calls[0][1].headers.Authorization, 'Bearer session-1');
  assert.equal(app.calls[1][1].headers.Authorization, 'Bearer session-2');
});
test('missing or unavailable Clerk tokens prevent writes before they reach the server', async () => {
  for (const provider of [async () => null, async () => { throw new Error('Session unavailable'); }]) {
    const app = client(() => { throw new Error('Must not call the API'); });
    app.setAuthTokenProvider(provider);
    await assert.rejects(app.api('/tasks', 'POST', { title: 'Keep this draft' }, 'idempotency-key'), error => error.status === 401);
    assert.equal(app.calls.length, 0);
  }
});
test('sign-out while obtaining a token prevents a late write', async () => {
  const app = client(() => { throw new Error('Must not call the API'); });
  let resolveToken;
  app.setAuthTokenProvider(() => new Promise(resolve => { resolveToken = resolve; }));
  const pending = app.api('/tasks', 'POST', { title: 'Keep this draft' });
  app.setAuthTokenProvider(async () => null);
  resolveToken('old-session');
  await assert.rejects(pending, error => error.status === 401);
  assert.equal(app.calls.length, 0);
});
test('a response arriving after an account change cannot repopulate the private view', async () => {
  let finishBody;
  const app = client(() => ({ status: 200, ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: () => new Promise(resolve => { finishBody = resolve; }) }));
  app.setAuthTokenProvider(async () => 'old-session');
  const pending = app.api('/tasks');
  await new Promise(resolve => setImmediate(resolve));
  app.setAuthTokenProvider(async () => 'new-session');
  finishBody({ items: [{ title: 'Private task' }] });
  await assert.rejects(pending, error => error.status === 401);
});
test('an unauthorized write is not automatically retried with another token', async () => {
  const app = client(() => new Response('{"error":"invalid_session","message":"Sign in again."}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
  app.setAuthTokenProvider(async () => 'expired-session');
  await assert.rejects(app.api('/tasks', 'POST', { title: 'Draft stays here' }), error => error.status === 401 && error.code === 'invalid_session');
  assert.equal(app.calls.length, 1);
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
