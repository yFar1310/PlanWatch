import { z } from 'zod';

export const planIdSchema = z.coerce.number().int().positive().max(2_147_483_647);
const fields = z.object({
  title: z.string().trim().min(3).max(200),
  expectedMinutes: z.number().int().positive(),
  actualMinutes: z.number().int().nonnegative().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
  note: z.string().trim().max(500).nullable().optional(),
  dependsOn: planIdSchema.nullable().optional(),
  status: z.enum(['not_started', 'in_progress', 'done']).optional(),
  projectId: planIdSchema.nullable().optional(),
  priority: z.number().int().min(-5).max(5).optional(),
  recurrenceRule: z.string().trim().max(500).nullable().optional(),
});
export const createPlanSchema = fields;
export const updatePlanSchema = fields.partial().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: 'Provide at least one task field to update.' },
);

export type PlanRow = {
  id: number; userId: number; title: string; expectedMinutes: number;
  actualMinutes: number | null; dueAt: Date | string; note: string | null;
  dependsOn: number | null; status: string; createdAt: Date | string;
  projectId: number | null; priority: number; recurrenceRule: string | null;
};

export class PlanError extends Error {
  constructor(public code: string, message: string, public status: 400 | 404 | 409 | 415 = 400) { super(message); }
}

/** Validate while the mutation holds the owner's graph transaction lock. */
export function validateDependencies(plan: Pick<PlanRow, 'id' | 'dependsOn' | 'dueAt'>, graph: PlanRow[]) {
  const byId = new Map(graph.map((task) => [task.id, task]));
  const visited = new Set([plan.id]);
  let nextId = plan.dependsOn;
  while (nextId != null) {
    if (visited.has(nextId)) throw new PlanError('dependency_cycle', 'This dependency would create a loop. Choose a different task.');
    visited.add(nextId);
    const parent = byId.get(nextId);
    if (!parent) throw new PlanError('dependency_not_found', 'The selected dependency is no longer available.');
    nextId = parent.dependsOn;
  }
  const parent = plan.dependsOn == null ? null : byId.get(plan.dependsOn);
  if (parent && new Date(plan.dueAt) < new Date(parent.dueAt)) {
    throw new PlanError('invalid_dependency_due_at', `Choose a due date on or after "${parent.title}".`);
  }
  const child = graph.find((task) => task.dependsOn === plan.id && new Date(task.dueAt) < new Date(plan.dueAt));
  if (child) throw new PlanError('invalid_dependent_due_at', `"${child.title}" depends on this task. Reschedule it first or choose an earlier due date.`);
}
