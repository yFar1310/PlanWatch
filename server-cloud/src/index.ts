import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { PlansStore } from './store';

type Bindings = {
  PLANS: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Bindings }>();

// CORS configuration
app.use('*', cors({
  origin: ['https://planwatch.pages.dev'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Get Plans store instance
const getPlansStore = (c: any) => {
  const id = c.env.PLANS.idFromName('default');
  return c.env.PLANS.get(id);
};

// Forward all /api/plans requests to Durable Object
app.all('/api/*', async (c) => {
  const store = getPlansStore(c);
  const response = await store.fetch(c.req.raw);
  return new Response(response.body, response);
});

export default {
  fetch: app.fetch,
  PlansStore
};