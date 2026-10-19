import type { Context } from 'hono';
import type { JWTPayload } from '../middlewares/auth.js';
import { createPlanSchema } from '../domain/plans.js';
import { createPlan } from '../services/plans.js';
import { readPlanBody, planMutationError } from './planMutation.js';

export default async function submitHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) return c.json({ ok: false, error: 'unauthorized' }, 401);
  try {
    const plan = await createPlan(auth.userId, await readPlanBody(c, createPlanSchema));
    return c.json({ ok: true, plan }, 201);
  } catch (error) { return planMutationError(c, error); }
}
