import type { Context } from 'hono';
import type { JWTPayload } from '../middlewares/auth.js';
import { planIdSchema, updatePlanSchema } from '../domain/plans.js';
import { updatePlan } from '../services/plans.js';
import { readPlanBody, planMutationError } from './planMutation.js';

export default async function updatePlanHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) return c.json({ ok: false, error: 'unauthorized' }, 401);
  const id = planIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ ok: false, error: 'invalid_id', message: 'Choose a valid task.' }, 400);
  try {
    const plan = await updatePlan(auth.userId, id.data, await readPlanBody(c, updatePlanSchema));
    return c.json({ ok: true, plan });
  } catch (error) { return planMutationError(c, error); }
}
