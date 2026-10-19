import { Hono } from 'hono';
import { ZodError, z } from 'zod';
import { createSchema, patchSchema, versionSchema, idSchema, Problem, listTasks, getTask, createTask, updateTask, setDeleted } from './tasks';
import { authenticate, AuthError, type AuthBindings, type Session } from './auth';

export interface Bindings extends AuthBindings { DB: D1Database }
const app = new Hono<{ Bindings: Bindings; Variables: { session: Session } }>();

// Local bypass is loopback-only. Hosted requests require verified Access tokens and the allowed owner.
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  const session = await authenticate(c.req.raw, c.env);
  c.set('session', session);
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if ((session.mode === 'access' && !origin) || (origin && origin !== new URL(c.req.url).origin)) return c.json({ error: 'invalid_origin', message: 'Use the app to make this change.' }, 403);
    if (!c.req.header('Content-Type')?.includes('application/json')) throw new Problem('invalid_content_type', 'Send task changes as JSON.', 415);
  }
  await next();
});

async function body<T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>) {
  let input: unknown;
  try { input = await c.req.json(); } catch { throw new Problem('invalid_json', 'The request could not be read.'); }
  return schema.parse(input);
}

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1 FROM tasks LIMIT 1').all();
  return c.json({ ok: true });
});
app.get('/api/session', (c) => {
  const { mode, email, expiresAt } = c.get('session');
  return c.json({ mode, email, expiresAt });
});
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
  if (detail.includes('dependency_cycle')) return c.json({ error: 'dependency_cycle', message: 'This dependency would create a loop. Choose another task.' }, 400);
  if (detail.includes('dependency_not_found')) return c.json({ error: 'dependency_not_found', message: 'That dependency is unavailable.' }, 400);
  console.error('Request failed', { name: error.name, message: error.message });
  return c.json({ error: 'internal', message: 'We could not complete this request. Please try again.' }, 500);
});

export default app;
