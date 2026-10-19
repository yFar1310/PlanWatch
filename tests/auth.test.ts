import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker, { type Bindings } from '../worker';
import { testEnv } from './setup';
import { createTask } from '../worker/tasks';

const origin = 'https://planwatch.example';
const team = 'planwatch-tests.cloudflareaccess.com';
const issuer = `https://${team}`;
const env: Bindings = { ...testEnv, LOCAL_DEV: 'false', ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: 'planwatch-tests', OWNER_EMAIL: 'owner@example.com' };
const pair = await generateKeyPair('RS256', { extractable: true });
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
async function token(claims: Record<string, unknown> = {}, key = pair.privateKey) {
  return new SignJWT({ email: 'owner@example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(typeof claims.iss === 'string' ? claims.iss : issuer)
    .setAudience(typeof claims.aud === 'string' ? claims.aud : 'planwatch-tests')
    .setSubject(typeof claims.sub === 'string' ? claims.sub : 'stable-access-subject').setIssuedAt(typeof claims.iat === 'number' ? claims.iat : undefined)
    .setExpirationTime(typeof claims.exp === 'number' ? claims.exp : '1h').sign(key);
}
async function request(path = '/session', jwt?: string, method = 'GET', body?: unknown, originHeader: string | null = origin) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (jwt) headers.set('Cf-Access-Jwt-Assertion', jwt);
  if (originHeader) headers.set('Origin', originHeader);
  if (method === 'POST') headers.set('Idempotency-Key', crypto.randomUUID());
  const response = await worker.request(origin + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return { status: response.status, data: await response.json() as any, headers: response.headers };
}
beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${issuer}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [publicKey] }), { headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://unavailable-tests.cloudflareaccess.com/cdn-cgi/access/certs') return new Response('Unavailable', { status: 503 });
    throw new Error('Unexpected external request in authentication test');
  });
});
afterAll(() => { vi.restoreAllMocks(); });
beforeEach(async () => { await testEnv.DB.batch([testEnv.DB.prepare('DELETE FROM tasks'), testEnv.DB.prepare('DELETE FROM task_events')]); });

describe('personal Cloudflare Access authentication', () => {
  it('returns a local session only on loopback with the local flag', async () => {
    const response = await worker.request('/api/session', {}, testEnv);
    expect(await response.json()).toEqual({ mode: 'local', email: null, expiresAt: null });
    const publicResponse = await worker.request(origin + '/api/session', {}, { ...env, LOCAL_DEV: 'true' });
    expect(publicResponse.status).toBe(401);
  });
  it('does not treat an identity header or arbitrary cookie as a verified session', async () => {
    expect((await request()).status).toBe(401);
    const response = await worker.request(origin + '/api/tasks', { headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com', Cookie: 'CF_Authorization=forged' } }, env);
    expect(response.status).toBe(401);
  });
  it('accepts a valid signed owner token and makes session data non-cacheable', async () => {
    const result = await request('/session', await token());
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ mode: 'access', email: 'owner@example.com' });
    expect(result.data.expiresAt).toBeGreaterThan(Date.now());
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('rejects expired, future-issued, wrong-audience and wrong-issuer tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [{ exp: now - 60 }, { iat: now + 60 }, { aud: 'another-app' }, { iss: 'https://another.cloudflareaccess.com' }]) {
      expect((await request('/tasks', await token(claims))).status).toBe(401);
    }
  });
  it('rejects altered tokens and signatures from another key', async () => {
    const other = await generateKeyPair('RS256');
    expect((await request('/tasks', await token({}, other.privateKey))).status).toBe(401);
    expect((await request('/tasks', 'not.a.valid-token')).status).toBe(401);
  });
  it('rejects signed users other than the configured owner before reading or changing tasks', async () => {
    const jwt = await token({ email: 'someone-else@example.com' });
    expect((await request('/tasks', jwt)).status).toBe(403);
    expect((await request('/tasks', jwt, 'POST', { title: 'Not allowed' })).status).toBe(403);
    expect((await testEnv.DB.prepare('SELECT count(*) AS count FROM tasks').first<{ count: number }>())?.count).toBe(0);
  });
  it('keeps the hosted personal workspace separate from local preview data', async () => {
    const local = await createTask(testEnv.DB, 'local-preview', crypto.randomUUID(), { title: 'Local draft task' });
    const jwt = await token();
    expect((await request('/tasks', jwt)).data.items).toHaveLength(0);
    expect((await request(`/tasks/${local.task.id}`, jwt)).status).toBe(404);
    expect((await request(`/tasks/${local.task.id}`, jwt, 'DELETE', { version: 1 })).status).toBe(404);
    const created = await request('/tasks', jwt, 'POST', { title: 'Private hosted task' });
    expect(created.status).toBe(201);
    expect((await request('/tasks', await token({ sub: 'another-provider-id' }))).data.items[0].id).toBe(created.data.task.id);
  });
  it('requires the matching Origin on hosted writes, including signed requests', async () => {
    const jwt = await token();
    expect((await request('/tasks', jwt, 'POST', { title: 'Origin check' }, null)).status).toBe(403);
    expect((await request('/tasks', jwt, 'POST', { title: 'Origin check' }, 'https://another.example')).status).toBe(403);
    expect((await request('/tasks', jwt, 'POST', { title: 'Origin check' })).status).toBe(201);
  });
  it('stays closed when hosted configuration is incomplete or unsafe', async () => {
    for (const invalid of [{ OWNER_EMAIL: '' }, { ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: 'https://unsafe.example' }]) {
      const response = await worker.request(origin + '/api/tasks', {}, { ...env, ...invalid });
      expect(response.status).toBe(503);
    }
  });
  it('rejects service identities without an email and empty subjects', async () => {
    expect((await request('/session', await token({ email: undefined }))).status).toBe(401);
    expect((await request('/session', await token({ sub: '' }))).status).toBe(401);
  });
  it('does not accept a different signing algorithm', async () => {
    const jwt = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer).setAudience('planwatch-tests').setSubject('owner').setIssuedAt().setExpirationTime('1h').sign(new Uint8Array(32));
    expect((await request('/session', jwt)).status).toBe(401);
  });
  it('reports a key-service outage without granting access or exposing provider errors', async () => {
    const jwt = await token({ iss: 'https://unavailable-tests.cloudflareaccess.com' });
    const response = await worker.request(origin + '/api/session', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }, { ...env, ACCESS_TEAM_DOMAIN: 'unavailable-tests.cloudflareaccess.com' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'auth_unavailable', message: 'Sign-in verification is temporarily unavailable. Please try again.' });
  });
});
