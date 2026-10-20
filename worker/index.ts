import { Hono } from 'hono';
import { ZodError, z } from 'zod';
import { createSchema, patchSchema, versionSchema, idSchema, Problem, listTasks, getTask, createTask, updateTask, setDeleted, listTimeline } from './tasks';
import { authenticate, AuthError, type AuthBindings, type Session, type Identity } from './auth';

import { trashSummary, purgeTasks, purgeSchema, emptyTrash, emptySchema } from './trash';
import { resolveWorkspace, requireAdmin, acceptInvitation, acceptSchema, createInvitation, invitationSchema, revokeInvitation, setMemberStatus, memberStatusSchema, recordActivity, activitySchema, dashboard } from './workspaces';

export interface Bindings extends AuthBindings { DB: D1Database }
const app = new Hono<{ Bindings: Bindings; Variables: { session: Session; identity: Identity } }>();

// The Pages frontend talks directly to the Worker. Preflight never reads D1 or requires a token.
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Vary', 'Origin');
  const url = new URL(c.req.url);
  const local = c.env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowedOrigin = local ? url.origin : c.env.APP_ORIGIN?.trim().replace(/\/$/, '');
  const origin = c.req.header('Origin');
  if (origin && origin !== allowedOrigin) return c.json({ error: 'invalid_origin', message: 'Open your private PlanWatch address to continue.' }, 403);
  if (origin && origin === allowedOrigin) c.header('Access-Control-Allow-Origin', origin);
  if (c.req.method === 'OPTIONS') {
    const method = c.req.header('Access-Control-Request-Method');
    const headers = c.req.header('Access-Control-Request-Headers')?.split(',').map(value => value.trim().toLowerCase()) ?? [];
    if (!origin || !method || !['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method) || headers.some(value => !['authorization', 'content-type', 'idempotency-key'].includes(value))) {
      return c.json({ error: 'invalid_preflight', message: 'This browser request is not allowed.' }, 403);
    }
    c.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    c.header('Access-Control-Max-Age', '600');
    return c.body(null, 204);
  }
  await next();
});

// Local bypass is loopback-only. Hosted requests require a verified Clerk session before workspace admission.
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  const session = await authenticate(c.req.raw, c.env);
  c.set('identity', session);
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (session.mode !== 'local' && !origin) return c.json({ error: 'invalid_origin', message: 'Use the app to make this change.' }, 403);
    if (!c.req.header('Content-Type')?.includes('application/json')) throw new Problem('invalid_content_type', 'Send task changes as JSON.', 415);
  }
  await next();
});

async function body<T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) {
  let input: unknown;
  try { input = await c.req.json(); } catch { throw new Problem('invalid_json', 'The request could not be read.'); }
  return schema.parse(input);
}

// Admission requires a signed identity, but not an existing workspace.
app.post('/api/invitations/accept', async c => {
  const identity = c.get('identity');
  if (identity.userId === c.env.CLERK_OWNER_USER_ID?.trim()) {
    await resolveWorkspace(c.env.DB, identity, c.env);
    throw new Problem('already_member', 'The administrator already has a private workspace.', 409);
  }
  return c.json(await acceptInvitation(c.env.DB, identity, await body(c, acceptSchema)), 201);
});
app.use('/api/*', async (c, next) => {
  c.set('session', await resolveWorkspace(c.env.DB, c.get('identity'), c.env));
  await next();
});
app.use('/api/admin/*', async (c, next) => { requireAdmin(c.get('session')); await next(); });
app.get('/api/admin', async c => c.json(await dashboard(c.env.DB, c.get('session'), new URL(c.req.url).searchParams)));
app.post('/api/admin/invitations', async c => c.json(await createInvitation(c.env.DB, c.get('session'), (await body(c, invitationSchema)).label, c.env.APP_ORIGIN!), 201));
app.delete('/api/admin/invitations/:id', async c => c.json(await revokeInvitation(c.env.DB, c.get('session'), idSchema.parse(c.req.param('id')))));
app.patch('/api/admin/users/:id', async c => c.json(await setMemberStatus(c.env.DB, c.get('session'), z.union([z.literal('personal'), idSchema]).parse(c.req.param('id')), await body(c, memberStatusSchema))));
app.post('/api/activity', async c => c.json(await recordActivity(c.env.DB, c.get('session'), (await body(c, activitySchema)).active)));
app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1 FROM tasks WHERE owner_id=? LIMIT 1').bind(c.get('session').ownerId).all();
  return c.json({ ok: true });
});
app.get('/api/session', (c) => {
  const { mode, email, expiresAt, workspaceId, displayName, canAdmin } = c.get('session');
  return c.json({ mode, email, expiresAt, workspaceId, displayName, canAdmin });
});
app.get('/api/timeline', async c => c.json(await listTimeline(c.env.DB,c.get('session').ownerId,new URL(c.req.url).searchParams)));
app.get('/api/trash/summary', async c => c.json(await trashSummary(c.env.DB,c.get('session').ownerId)));
app.post('/api/trash/purge', async c => c.json(await purgeTasks(c.env.DB,c.get('session').ownerId,await body(c,purgeSchema))));
app.delete('/api/trash/:id', async c => {
  const value=await body(c,z.object({version:z.number().int().positive(),confirmed:z.literal(true)}).strict());
  return c.json(await purgeTasks(c.env.DB,c.get('session').ownerId,{items:[{id:idSchema.parse(c.req.param('id')),version:value.version}],confirmed:true}));
});
app.post('/api/trash/empty', async c => c.json(await emptyTrash(c.env.DB,c.get('session').ownerId,(await body(c,emptySchema)).cutoff)));
app.get('/api/tasks', async (c) => c.json(await listTasks(c.env.DB, c.get('session').ownerId, new URL(c.req.url).searchParams)));
app.get('/api/tasks/:id', async (c) => c.json({ task: await getTask(c.env.DB, c.get('session').ownerId, idSchema.parse(c.req.param('id'))) }));
app.post('/api/tasks', async (c) => {
  const key = idSchema.parse(c.req.header('Idempotency-Key'));
  const saved = await createTask(c.env.DB, c.get('session').ownerId, key, await body(c, createSchema));
  return c.json({ task: saved.task }, saved.created ? 201 : 200);
});
app.patch('/api/tasks/:id', async (c) => c.json({
  task: await updateTask(c.env.DB, c.get('session').ownerId, idSchema.parse(c.req.param('id')), await body(c, patchSchema)),
}));
app.delete('/api/tasks/:id', async (c) => c.json({
  task: await setDeleted(c.env.DB, c.get('session').ownerId, idSchema.parse(c.req.param('id')), (await body(c, versionSchema)).version, true),
}));
app.post('/api/tasks/:id/restore', async (c) => c.json({
  task: await setDeleted(c.env.DB, c.get('session').ownerId, idSchema.parse(c.req.param('id')), (await body(c, versionSchema)).version, false),
}));
app.notFound((c) => c.json({ error: 'not_found', message: 'This endpoint does not exist.' }, 404));
app.onError((error, c) => {
  if (error instanceof AuthError) return c.json({ error: error.code, message: error.message }, error.status);
  if (error instanceof Problem) return c.json({ error: error.code, message: error.message }, error.status);
  if (error instanceof ZodError) return c.json({ error: 'validation', message: error.issues[0]?.message ?? 'Check the task fields.' }, 400);
  const detail = `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`;
  if (detail.includes('invalid_schedule')) return c.json({ error:'invalid_schedule',message:'Check the planned dates and start/end times.' },400);
  if (detail.includes('dependency_incomplete')) return c.json({ error: 'dependency_incomplete', message: 'Complete the prerequisite first, or remove this dependency before finishing the task.' }, 409);
  if (detail.includes('dependency_cycle')) return c.json({ error: 'dependency_cycle', message: 'This dependency would create a loop. Choose another task.' }, 400);
  if (detail.includes('dependency_not_found')) return c.json({ error: 'dependency_not_found', message: 'That dependency is unavailable.' }, 400);
  console.error('Request failed', { name: error.name, message: error.message });
  return c.json({ error: 'internal', message: 'We could not complete this request. Please try again.' }, 500);
});

export default app;
