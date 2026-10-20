import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker, { type Bindings } from '../worker';
import { testEnv } from './setup';
import { createTask } from '../worker/tasks';

const origin = 'https://planwatch.example';
const issuer = 'https://planwatch-tests.clerk.accounts.dev';
const owner = 'user_PersonalOwner';
const env: Bindings = { ...testEnv, LOCAL_DEV: 'false', CLERK_ISSUER_URL: issuer, CLERK_OWNER_USER_ID: owner, APP_ORIGIN: origin };
const pair = await generateKeyPair('RS256', { extractable: true });
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
async function token(claims: Record<string, unknown> = {}, key = pair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, sub: owner, sid: 'sess_PersonalSession', v: 2, azp: origin, iat: now, nbf: now - 5, exp: now + 60, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
}
async function request(path = '/session', jwt?: string, method = 'GET', body?: unknown, originHeader: string | null = origin) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
  if (originHeader) headers.set('Origin', originHeader);
  if (method === 'POST') headers.set('Idempotency-Key', crypto.randomUUID());
  const response = await worker.request(origin + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return { status: response.status, data: await response.json() as any, headers: response.headers };
}
beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${issuer}/.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [publicKey] }), { headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://unavailable-tests.clerk.accounts.dev/.well-known/jwks.json') return new Response('Unavailable', { status: 503 });
    throw new Error('Unexpected external request in authentication test');
  });
});
afterAll(() => { vi.restoreAllMocks(); });
beforeEach(async () => { await testEnv.DB.batch([testEnv.DB.prepare('DELETE FROM tasks'), testEnv.DB.prepare('DELETE FROM task_events')]); });

describe('personal Clerk authentication', () => {
  it('returns a local session only on loopback with the local flag', async () => {
    const response = await worker.request('/api/session', {}, testEnv);
    expect(await response.json()).toEqual({ mode: 'local', email: null, expiresAt: null });
    expect((await worker.request(origin + '/api/session', {}, { ...env, LOCAL_DEV: 'true' })).status).toBe(401);
  });
  it('does not treat identity headers, Access tokens, cookies, query strings, or API keys as sessions', async () => {
    expect((await request()).status).toBe(401);
    const jwt = await token();
    const untrustedHeaders: Record<string, string>[] = [
      { 'Cf-Access-Jwt-Assertion': jwt, 'Cf-Access-Authenticated-User-Email': 'owner@example.com' },
      { Cookie: `__session=${jwt}` }, { Authorization: 'Bearer sk_test_not_a_session' },
    ];
    for (const headers of untrustedHeaders) {
      expect((await worker.request(origin + '/api/tasks', { headers }, env)).status).toBe(401);
    }
    expect((await worker.request(`${origin}/api/tasks?token=${jwt}`, {}, env)).status).toBe(401);
  });
  it('accepts a valid signed owner session and makes data non-cacheable', async () => {
    const result = await request('/session', await token());
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ mode: 'clerk', email: null });
    expect(result.data.expiresAt).toBeGreaterThan(Date.now());
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('rejects expired, future-issued, not-yet-valid, wrong-origin and wrong-instance tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [{ exp: now - 60 }, { iat: now + 60 }, { nbf: now + 60 }, { azp: 'https://another.example' }, { iss: 'https://another.clerk.accounts.dev' }]) {
      expect((await request('/tasks', await token(claims))).status).toBe(401);
    }
  });
  it('rejects altered tokens and signatures from another key', async () => {
    const other = await generateKeyPair('RS256');
    expect((await request('/tasks', await token({}, other.privateKey))).status).toBe(401);
    expect((await request('/tasks', 'not.a.valid-token')).status).toBe(401);
  });
  it('rejects another signed user even when their email claim matches the owner', async () => {
    const jwt = await token({ sub: 'user_SomeoneElse', email: 'owner@example.com' });
    expect((await request('/tasks', jwt)).status).toBe(403);
    expect((await request('/tasks', jwt, 'POST', { title: 'Not allowed' })).status).toBe(403);
    expect((await testEnv.DB.prepare('SELECT count(*) AS count FROM tasks').first<{ count: number }>())?.count).toBe(0);
  });
  it('keeps the hosted workspace stable across sessions and separate from local data', async () => {
    const local = await createTask(testEnv.DB, 'local-preview', crypto.randomUUID(), { title: 'Local draft task' });
    const jwt = await token();
    expect((await request('/tasks', jwt)).data.items).toHaveLength(0);
    expect((await request(`/tasks/${local.task.id}`, jwt)).status).toBe(404);
    expect((await request(`/tasks/${local.task.id}`, jwt, 'DELETE', { version: 1 })).status).toBe(404);
    const created = await request('/tasks', jwt, 'POST', { title: 'Private hosted task' });
    expect(created.status).toBe(201);
    expect((await request('/tasks', await token({ sid: 'sess_RenewedSession' }))).data.items[0].id).toBe(created.data.task.id);
  });
  it('requires the matching Origin on hosted writes, including signed requests', async () => {
    const jwt = await token();
    expect((await request('/tasks', jwt, 'POST', { title: 'Origin check' }, null)).status).toBe(403);
    expect((await request('/tasks', jwt, 'POST', { title: 'Origin check' }, 'https://another.example')).status).toBe(403);
    expect((await request('/tasks', jwt, 'POST', { title: 'Origin check' })).status).toBe(201);
  });
  it('rejects alternate app hostnames rather than trusting the request host as an authorized party', async () => {
    const response = await worker.request('https://alternate.example/api/tasks', { headers: { Authorization: `Bearer ${await token()}` } }, env);
    expect(response.status).toBe(403);
  });
  it('stays closed when hosted configuration is incomplete or unsafe', async () => {
    for (const invalid of [
      { CLERK_OWNER_USER_ID: '' }, { CLERK_OWNER_USER_ID: 'first-user-wins' }, { CLERK_ISSUER_URL: '' },
      { CLERK_ISSUER_URL: 'http://unsafe.example' }, { CLERK_ISSUER_URL: `${issuer}/other-path` },
      { APP_ORIGIN: 'http://public.example' }, { APP_ORIGIN: `${origin}/some-path` }, { APP_ORIGIN: '' },
    ]) {
      expect((await worker.request(origin + '/api/tasks', {}, { ...env, ...invalid })).status).toBe(503);
    }
  });
  it('rejects incomplete sessions and unsupported token versions', async () => {
    for (const claims of [{ sub: '' }, { sub: undefined }, { sid: undefined }, { sid: '' }, { exp: undefined }, { nbf: undefined }, { iat: undefined }, { azp: undefined }, { v: 1 }]) {
      expect((await request('/session', await token(claims))).status).toBe(401);
    }
  });
  it('rejects pending sessions and impersonation tokens', async () => {
    expect((await request('/session', await token({ sts: 'pending' }))).status).toBe(401);
    expect((await request('/session', await token({ act: { sub: 'user_Impersonator' } }))).status).toBe(401);
  });
  it('does not accept a different signing algorithm', async () => {
    const jwt = await new SignJWT({ sub: owner }).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
    expect((await request('/session', jwt)).status).toBe(401);
  });
  it('reports a key-service outage without granting access or exposing provider errors', async () => {
    const unavailable = 'https://unavailable-tests.clerk.accounts.dev';
    const response = await worker.request(origin + '/api/session', { headers: { Authorization: `Bearer ${await token({ iss: unavailable })}` } }, { ...env, CLERK_ISSUER_URL: unavailable });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'auth_unavailable', message: 'Sign-in verification is temporarily unavailable. Please try again.' });
  });
  it('permits the Pages origin to read and change tasks through a separate Worker', async () => {
    const apiOrigin = 'https://planwatch-api.workers.dev';
    const pagesOrigin = 'https://planwatch.pages.dev';
    const splitEnv = { ...env, APP_ORIGIN: pagesOrigin, API_ORIGIN: apiOrigin };
    const response = await worker.request(`${apiOrigin}/api/tasks`, {
      method: 'POST', headers: { Authorization: `Bearer ${await token({ azp: pagesOrigin })}`, Origin: pagesOrigin, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ title: 'Created from Pages' }),
    }, splitEnv);
    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(pagesOrigin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    const read = await worker.request(`${apiOrigin}/api/tasks`, { headers: { Authorization: `Bearer ${await token({ azp: pagesOrigin })}`, Origin: pagesOrigin } }, splitEnv);
    expect(read.status).toBe(200);
    expect((await read.json() as any).items[0].title).toBe('Created from Pages');
  });
  it('allows only the configured Pages origin, methods and headers on tokenless preflight', async () => {
    const apiOrigin = 'https://planwatch-api.workers.dev';
    const pagesOrigin = 'https://planwatch.pages.dev';
    const splitEnv = { ...env, APP_ORIGIN: pagesOrigin, API_ORIGIN: apiOrigin };
    const headers = { Origin: pagesOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' };
    const ok = await worker.request(`${apiOrigin}/api/tasks`, { method: 'OPTIONS', headers }, splitEnv);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(pagesOrigin);
    expect(ok.headers.get('Vary')).toBe('Origin');
    for (const invalid of [{ Origin: 'https://other.pages.dev' }, { 'Access-Control-Request-Method': 'PUT' }, { 'Access-Control-Request-Headers': 'x-unexpected' }]) {
      const denied = await worker.request(`${apiOrigin}/api/tasks`, { method: 'OPTIONS', headers: { ...headers, ...invalid } }, splitEnv);
      expect(denied.status).toBe(403);
    }
    expect((await testEnv.DB.prepare('SELECT count(*) AS count FROM tasks').first<{ count: number }>())?.count).toBe(0);
  });
  it('includes CORS headers on sign-in errors without allowing another origin', async () => {
    const apiOrigin = 'https://planwatch-api.workers.dev';
    const pagesOrigin = 'https://planwatch.pages.dev';
    const splitEnv = { ...env, APP_ORIGIN: pagesOrigin, API_ORIGIN: apiOrigin };
    const unauthenticated = await worker.request(`${apiOrigin}/api/tasks`, { headers: { Origin: pagesOrigin } }, splitEnv);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe(pagesOrigin);
    const denied = await worker.request(`${apiOrigin}/api/tasks`, { headers: { Origin: 'https://other.pages.dev', Authorization: `Bearer ${await token({ azp: pagesOrigin })}` } }, splitEnv);
    expect(denied.status).toBe(403);
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const missingOrigin = await worker.request(`${apiOrigin}/api/tasks`, { method: 'POST', headers: { Authorization: `Bearer ${await token({ azp: pagesOrigin })}`, 'Content-Type': 'application/json' }, body: '{"title":"Not allowed"}' }, splitEnv);
    expect(missingOrigin.status).toBe(403);
  });
});
