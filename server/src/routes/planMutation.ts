import type { Context } from 'hono';
import { ZodError, type ZodType } from 'zod';
import { PlanError } from '../domain/plans.js';

export async function readPlanBody<T>(c: Context, schema: ZodType<T, any, any>): Promise<T> {
  if (!c.req.header('content-type')?.includes('application/json')) {
    throw new PlanError('unsupported_media_type', 'Send task changes as JSON.', 415);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new PlanError('invalid_json', 'The task could not be read. Check the submitted fields.'); }
  return schema.parse(body);
}

export function planMutationError(c: Context, error: unknown) {
  if (error instanceof ZodError) return c.json({ ok: false, error: 'validation', message: 'Check the task fields and try again.', issues: error.issues }, 400);
  if (error instanceof PlanError) return c.json({ ok: false, error: error.code, message: error.message }, error.status);
  console.error('Task mutation failed', error);
  return c.json({ ok: false, error: 'internal', message: 'We could not save your task. Please try again.' }, 500);
}
