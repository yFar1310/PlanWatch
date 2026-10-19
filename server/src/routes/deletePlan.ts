import type { Context } from 'hono';
import type { JWTPayload } from '../middlewares/auth.js';
import { planIdSchema } from '../domain/plans.js';
import { deletePlan } from '../services/plans.js';
import { planMutationError } from './planMutation.js';

export default async function deletePlanHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) return c.json({ ok: false, error: 'unauthorized' }, 401);
  const id = planIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ ok: false, error: 'invalid_id', message: 'Choose a valid task.' }, 400);
  try {
    await deletePlan(auth.userId, id.data);
    return c.json({ ok: true });
  } catch (error) { return planMutationError(c, error); }
}
