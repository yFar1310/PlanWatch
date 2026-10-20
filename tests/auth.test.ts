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
beforeEach(async () => { await testEnv.DB.batch([testEnv.DB.prepare('DELETE FROM usage_sessions'), testEnv.DB.prepare('DELETE FROM invitations'), testEnv.DB.prepare('DELETE FROM workspaces'), testEnv.DB.prepare('DELETE FROM tasks'), testEnv.DB.prepare('DELETE FROM task_events'), testEnv.DB.prepare('DELETE FROM purged_tasks')]); });

describe('personal Clerk authentication', () => {
  it('returns a local session only on loopback with the local flag', async () => {
    const response = await worker.request('/api/session', {}, testEnv);
    expect(await response.json()).toEqual({ mode: 'local', email: null, expiresAt: null, workspaceId: 'local-preview', displayName: 'Local preview', canAdmin: false });
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

async function invite(jwt: string) {
  const created = await request('/admin/invitations', jwt, 'POST', { label: 'For a friend' });
  expect(created.status).toBe(201);
  return { ...created.data, code: new URL(created.data.link).hash.slice('#invite='.length) };
}
async function joinUser(adminJwt: string, userId: string, name = 'Friend') {
  const invitation = await invite(adminJwt);
  const jwt = await token({ sub: userId, sid: `sess_${userId.slice(5)}` });
  const joined = await request('/invitations/accept', jwt, 'POST', { code: invitation.code, displayName: name, usageAcknowledged: true });
  expect(joined.status).toBe(201);
  return { jwt, invitation, session: (await request('/session', jwt)).data };
}
describe('invited private workspaces and administration', () => {
  it('keeps existing personal data and reserves administration for the configured account', async () => {
    const task = await createTask(testEnv.DB, 'personal', crypto.randomUUID(), { title: 'Existing private task' });
    const admin = await token();
    expect((await request('/tasks', admin)).data.items[0].id).toBe(task.task.id);
    expect((await request('/session', admin)).data).toMatchObject({ workspaceId: 'personal', canAdmin: true });
    const friend = await joinUser(admin, 'user_Alice');
    expect(friend.session.canAdmin).toBe(false);
    expect(friend.session.workspaceId).not.toBe('personal');
    for (const [path, method, body] of [
      ['/admin', 'GET', undefined], ['/admin/invitations', 'POST', { label: 'Forbidden' }],
      [`/admin/invitations/${friend.invitation.invitation.id}`, 'DELETE', {}],
      ['/admin/users/personal', 'PATCH', { status: 'banned', version: 1 }],
    ] as const) expect((await request(path, friend.jwt, method, body)).status).toBe(403);
    expect((await request('/admin/users/personal', admin, 'PATCH', { status: 'banned', version: 1 })).data.error).toBe('protected_admin');
    const adminInvite = await invite(admin);
    expect((await request('/invitations/accept', admin, 'POST', { code: adminInvite.code, displayName: 'Oops', usageAcknowledged: true })).status).toBe(409);
    expect((await request('/session', admin)).data.workspaceId).toBe('personal');
  });
  it('requires admission, acknowledgment and a valid unused link; stores only its hash', async () => {
    const admin = await token(), other = await token({ sub: 'user_Alice', sid: 'sess_Alice' });
    expect((await request('/session', other)).data.error).toBe('invitation_required');
    const invitation = await invite(admin);
    const stored = await testEnv.DB.prepare('SELECT * FROM invitations WHERE id=?').bind(invitation.invitation.id).first();
    expect(JSON.stringify(stored)).not.toContain(invitation.code);
    expect((await request('/invitations/accept', other, 'POST', { code: invitation.code, displayName: 'Alice' })).status).toBe(400);
    expect((await request('/invitations/accept', other, 'POST', { code: invitation.code, displayName: 'Alice', usageAcknowledged: true })).status).toBe(201);
    const bob = await token({ sub: 'user_Bob', sid: 'sess_Bob' });
    expect((await request('/invitations/accept', bob, 'POST', { code: invitation.code, displayName: 'Bob', usageAcknowledged: true })).data.error).toBe('invalid_invitation');
    expect((await request('/session', bob)).status).toBe(403);
    expect((await request('/invitations/accept', other, 'POST', { code: invitation.code, displayName: 'Alice', usageAcknowledged: true })).data.error).toBe('already_member');
  });
  it('revokes and expires invitations and limits unused invitations', async () => {
    const admin = await token(), other = await token({ sub: 'user_Alice', sid: 'sess_Alice' });
    const revoked = await invite(admin);
    expect((await request(`/admin/invitations/${revoked.invitation.id}`, admin, 'DELETE', {})).status).toBe(200);
    const expired = await invite(admin);
    await testEnv.DB.prepare('UPDATE invitations SET created_at=?,expires_at=? WHERE id=?').bind(Date.now()-20000,Date.now()-10000,expired.invitation.id).run();
    for (const code of [revoked.code, expired.code, 'a'.repeat(43)]) expect((await request('/invitations/accept', other, 'POST', { code, displayName: 'Alice', usageAcknowledged: true })).data.error).toBe('invalid_invitation');
    for (let i = 0; i < 20; i++) await invite(admin);
    expect((await request('/admin/invitations', admin, 'POST', { label: 'One too many' })).data.error).toBe('invitation_limit');
  });
  it('allows only one of two simultaneous redemptions to create a workspace', async () => {
    const admin = await token(), invitation = await invite(admin);
    const results = await Promise.all(['Alice','Bob'].map(async name => request('/invitations/accept', await token({ sub: `user_${name}`, sid: `sess_${name}` }), 'POST', { code: invitation.code, displayName: name, usageAcknowledged: true })));
    expect(results.map(r => r.status).sort()).toEqual([201,400]);
    const rows = await testEnv.DB.prepare("SELECT count(*) AS count FROM workspaces WHERE id<>'personal'").first<{count:number}>();
    expect(rows?.count).toBe(1);
  });
  it('isolates tasks, history, dependencies, idempotency and pagination across members', async () => {
    const admin = await token();
    const alice = await joinUser(admin, 'user_Alice', 'Alice'), bob = await joinUser(admin, 'user_Bob', 'Bob');
    const secret = await request('/tasks', alice.jwt, 'POST', { title: 'Alice secret', notes: 'Private note' });
    await request('/tasks', alice.jwt, 'POST', { title: 'Second Alice task' });
    const own = await request('/tasks', bob.jwt, 'POST', { title: 'Bob task' });
    expect((await request('/tasks?q=Alice', bob.jwt)).data.items).toHaveLength(0);
    expect((await request('/tasks?view=trash', bob.jwt)).data.items).toHaveLength(0);
    for (const [method, suffix, body] of [
      ['GET','',undefined], ['PATCH','',{ version:1,title:'Stolen' }], ['DELETE','',{version:1}], ['POST','/restore',{version:1}],
    ] as const) expect((await request(`/tasks/${secret.data.task.id}${suffix}`,bob.jwt,method,body)).status).toBe(404);
    expect((await request(`/tasks/${own.data.task.id}`,bob.jwt,'PATCH',{version:1,dependsOn:secret.data.task.id})).status).toBe(400);
    expect((await request('/tasks', bob.jwt, 'POST', { title:'Spoof owner',ownerId:alice.session.workspaceId })).status).toBe(400);
    const page = await request('/tasks?limit=1',alice.jwt);
    expect(page.data.nextCursor).toBeTruthy();
    expect((await request(`/tasks?limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`,bob.jwt)).data.error).toBe('invalid_cursor');
    const key = crypto.randomUUID();
    const make = (jwt:string) => worker.request(origin+'/api/tasks',{ method:'POST', headers:{Authorization:`Bearer ${jwt}`,Origin:origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({title:'Same request key'}) },env);
    expect((await make(alice.jwt)).status).toBe(201); expect((await make(bob.jwt)).status).toBe(201);
    const history = await testEnv.DB.prepare('SELECT owner_id FROM task_events WHERE task_id=?').bind(secret.data.task.id).all<{owner_id:string}>();
    expect(history.results.every(e=>e.owner_id===alice.session.workspaceId)).toBe(true);
    const dashboard = (await request('/admin',admin)).data;
    expect(dashboard.totals.members).toBe(3);
    expect(dashboard.members.find((m:any)=>m.id===alice.session.workspaceId).tasks).toBe(3);
    for (const privateValue of ['Alice secret','Private note','token_hash','redeemed_by',alice.invitation.code]) expect(JSON.stringify(dashboard)).not.toContain(privateValue);
  });
  it('bans the next request, prevents rejoining and restores access without removing data', async () => {
    const admin = await token(), alice = await joinUser(admin,'user_Alice');
    const task = await request('/tasks',alice.jwt,'POST',{title:'Keep this task'});
    await request('/activity',alice.jwt,'POST',{active:true});
    expect((await request(`/admin/users/${alice.session.workspaceId}`,admin,'PATCH',{status:'banned',version:1})).status).toBe(200);
    for (const [path,method,body] of [['/session','GET',undefined],['/tasks','GET',undefined],['/activity','POST',{active:true}],['/tasks','POST',{title:'Blocked'}]] as const) expect((await request(path,alice.jwt,method,body)).data.error).toBe('account_banned');
    const invitation = await invite(admin);
    expect((await request('/invitations/accept',alice.jwt,'POST',{code:invitation.code,displayName:'Again',usageAcknowledged:true})).data.error).toBe('account_banned');
    expect((await request(`/admin/users/${alice.session.workspaceId}`,admin,'PATCH',{status:'active',version:1})).status).toBe(409);
    expect((await request(`/admin/users/${alice.session.workspaceId}`,admin,'PATCH',{status:'active',version:2})).status).toBe(200);
    expect((await request('/tasks',alice.jwt)).data.items[0].id).toBe(task.data.task.id);
    const usage = await testEnv.DB.prepare('SELECT active,ended_at FROM usage_sessions').first();
    expect(usage?.active).toBe(0); expect(usage?.ended_at).not.toBeNull();
  });
  it('bounds active time, excludes idle and missing heartbeats, and never accepts a client duration', async () => {
    const admin=await token(), alice=await joinUser(admin,'user_Alice');
    const pulseToken=await token({sub:'user_Alice',sid:'sess_Alice',exp:Math.floor(Date.now()/1000)+600});
    const reportToken=await token({exp:Math.floor(Date.now()/1000)+600});
    let time=Date.now(); const now=vi.spyOn(Date,'now').mockImplementation(()=>time);
    try {
      await request('/activity',pulseToken,'POST',{active:true});
      time+=30000; await request('/activity',pulseToken,'POST',{active:true});
      await request('/activity',pulseToken,'POST',{active:true});
      time+=10000; await request('/activity',pulseToken,'POST',{active:false});
      time+=5000; await request('/activity',pulseToken,'POST',{active:true});
      time+=46000; const fresh=pulseToken; await request('/activity',fresh,'POST',{active:true});
      time+=40000; const newer=pulseToken; await request('/activity',newer,'POST',{active:true});
      expect((await request('/activity',newer,'POST',{active:true,duration:99999999})).status).toBe(400);
      const row=await testEnv.DB.prepare('SELECT active_ms FROM usage_sessions WHERE workspace_id=?').bind(alice.session.workspaceId).first<{active_ms:number}>();
      expect(row?.active_ms).toBe(60000);
      const report=await request('/admin',reportToken);
      expect(report.data.members.find((m:any)=>m.id===alice.session.workspaceId)).toMatchObject({sessions:1,activeMs:60000});
    } finally { now.mockRestore(); }
  });
});

describe('administration pagination and transactional enrollment', () => {
  it('paginates all members with tied timestamps and scopes search cursors', async () => {
    const admin=await token(); await request('/session',admin);
    await testEnv.DB.batch(Array.from({length:53},(_,index)=>testEnv.DB.prepare('INSERT INTO workspaces(id,clerk_user_id,display_name,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),`user_Paging${index}`,`Friend ${index}`,1)));
    const first=await request('/admin?q=Friend',admin);
    expect(first.data.members).toHaveLength(50); expect(first.data.nextCursor).toBeTruthy();
    const second=await request('/admin?q=Friend&cursor='+encodeURIComponent(first.data.nextCursor),admin);
    expect(second.data.members).toHaveLength(3); expect(second.data.nextCursor).toBeNull();
    expect(new Set([...first.data.members,...second.data.members].map((m:any)=>m.id)).size).toBe(53);
    expect((await request('/admin?q=Different&cursor='+encodeURIComponent(first.data.nextCursor),admin)).data.error).toBe('invalid_cursor');
  });
  it('does not consume an invitation if workspace creation fails', async () => {
    const admin=await token(), invitation=await invite(admin), friend=await token({sub:'user_Failure',sid:'sess_Failure'});
    await testEnv.DB.prepare("CREATE TRIGGER reject_workspace BEFORE INSERT ON workspaces WHEN NEW.clerk_user_id='user_Failure' BEGIN SELECT RAISE(ABORT,'simulated_workspace_failure'); END").run();
    try { expect((await request('/invitations/accept',friend,'POST',{code:invitation.code,displayName:'Friend',usageAcknowledged:true})).status).toBe(500); }
    finally { await testEnv.DB.prepare('DROP TRIGGER reject_workspace').run(); }
    const row=await testEnv.DB.prepare('SELECT redeemed_at FROM invitations WHERE id=?').bind(invitation.invitation.id).first();
    expect(row?.redeemed_at).toBeNull();
    expect((await request('/invitations/accept',friend,'POST',{code:invitation.code,displayName:'Friend',usageAcknowledged:true})).status).toBe(201);
  });
});

describe('private Trash and timeline boundaries', () => {
  it('keeps permanent deletion, empty Trash and schedules inside the signed-in workspace', async () => {
    const admin=await token(),alice=await joinUser(admin,'user_Alice'),bob=await joinUser(admin,'user_Bob');
    const a=(await request('/tasks',alice.jwt,'POST',{title:'Alice schedule',plannedDate:'2026-10-20',startTime:'09:00',endTime:'10:00'})).data.task;
    const b=(await request('/tasks',bob.jwt,'POST',{title:'Bob schedule',plannedDate:'2026-10-20'})).data.task;
    const page=(await request('/timeline?from=2026-10-19&to=2026-10-25',alice.jwt)).data;
    expect(page.items.map((t:any)=>t.id)).toEqual([a.id]);expect(JSON.stringify(page)).not.toContain('Bob schedule');
    const deletedA=(await request(`/tasks/${a.id}`,alice.jwt,'DELETE',{version:a.version})).data.task;
    const deletedB=(await request(`/tasks/${b.id}`,bob.jwt,'DELETE',{version:b.version})).data.task;
    expect((await request(`/trash/${b.id}`,alice.jwt,'DELETE',{version:deletedB.version,confirmed:true})).status).toBe(409);
    expect((await request('/trash/purge',alice.jwt,'POST',{items:[{id:a.id,version:deletedA.version},{id:b.id,version:deletedB.version}],confirmed:true})).status).toBe(409);
    expect((await request('/trash/summary',alice.jwt)).data.count).toBe(1);expect((await request('/trash/summary',bob.jwt)).data.count).toBe(1);
    const summary=(await request('/trash/summary',alice.jwt)).data;
    expect((await request('/trash/empty',alice.jwt,'POST',{cutoff:summary.cutoff,confirmed:true})).data.ids).toEqual([a.id]);
    expect((await request('/trash/summary',bob.jwt)).data.count).toBe(1);
    const bobHistory=await testEnv.DB.prepare('SELECT count(*) AS count FROM task_events WHERE owner_id=? AND task_id=?').bind(bob.session.workspaceId,b.id).first<{count:number}>();expect(bobHistory?.count).toBe(2);
    expect((await request('/timeline?from=2026-10-19&to=2026-10-25',alice.jwt)).data.items).toHaveLength(0);
  });
});
