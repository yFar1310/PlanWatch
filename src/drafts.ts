import { ref, watch } from 'vue';
import type { Task, TaskPriority } from '../shared/tasks';
import { currentDay, isCalendarDay } from '../shared/calendar';

export interface TaskDraft {
  title: string;
  notes: string;
  status: Task['status'];
  priority: TaskPriority;
  dependsOn: string | null;
  plannedDate: string;
  estimate: string;
  actual: string;
  version: number;
}
interface CaptureDraft { title: string; plannedDate: string; key: string | null; payload: string | null; priority: TaskPriority; dependsOn: string | null }
const draftKey = 'planwatch:task-drafts:v1';
const captureKey = 'planwatch:capture:v1';
export const storageAvailable = ref(true);

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); }
  catch { storageAvailable.value = false; return null; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { storageAvailable.value = false; }
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isDraft(value: unknown): value is TaskDraft {
  return record(value) && ['title', 'notes', 'plannedDate', 'estimate', 'actual'].every(key => typeof value[key] === 'string')
    && (value.priority === undefined || ['urgent','high','medium','low'].includes(String(value.priority)))
    && (value.dependsOn === undefined || value.dependsOn === null || (typeof value.dependsOn === 'string' && /^[0-9a-f-]{36}$/i.test(value.dependsOn)))
    && ['todo', 'doing', 'done'].includes(String(value.status)) && Number.isSafeInteger(value.version) && Number(value.version) > 0;
}
const emptyCapture = (): CaptureDraft => ({ title: '', plannedDate: currentDay(), key: null, payload: null, priority: 'medium', dependsOn: null });
export const drafts = ref<Record<string, TaskDraft>>({});
export const capture = ref<CaptureDraft>(emptyCapture());
let scope: string | null = null;
function scoped(key: string) { return `${key}:${scope}`; }
export function deactivateDrafts() {
  scope = null;
  drafts.value = {};
  capture.value = emptyCapture();
}
export function activateDrafts(workspaceId: string, allowLegacy = false) {
  if (scope === workspaceId) return;
  deactivateDrafts();
  const stored = read(`${draftKey}:${workspaceId}`) ?? (allowLegacy ? read(draftKey) : null);
  const saved = read(`${captureKey}:${workspaceId}`) ?? (allowLegacy ? read(captureKey) : null);
  drafts.value = record(stored) ? Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, TaskDraft] => isDraft(entry[1])).map(([id, draft]) => [id, { ...draft, priority: draft.priority ?? 'medium', dependsOn: draft.dependsOn ?? null }])) : {};
  capture.value = record(saved) && typeof saved.title === 'string' && typeof saved.plannedDate === 'string' && (!saved.plannedDate || isCalendarDay(saved.plannedDate))
    ? { title: saved.title, plannedDate: saved.plannedDate, key: typeof saved.key === 'string' ? saved.key : null, payload: typeof saved.payload === 'string' ? saved.payload : null, priority: ['urgent','high','medium','low'].includes(String(saved.priority)) ? saved.priority as TaskPriority : 'medium', dependsOn: typeof saved.dependsOn === 'string' ? saved.dependsOn : null } : emptyCapture();
  scope = workspaceId;
  write(scoped(draftKey), drafts.value);
  write(scoped(captureKey), capture.value);
  if (allowLegacy && storageAvailable.value) {
    try { localStorage.removeItem(draftKey); localStorage.removeItem(captureKey); } catch { storageAvailable.value = false; }
  }
}
watch(drafts, () => { if (scope) write(scoped(draftKey), drafts.value); }, { deep: true, flush: 'sync' });
watch(capture, () => { if (scope) write(scoped(captureKey), capture.value); }, { deep: true, flush: 'sync' });

export function fromTask(task: Task): TaskDraft {
  return { title: task.title, notes: task.notes ?? '', status: task.status, priority: task.priority ?? 'medium', dependsOn: task.dependsOn ?? null, plannedDate: task.plannedDate ?? '', estimate: task.estimateMinutes?.toString() ?? '', actual: task.actualMinutes?.toString() ?? '', version: task.version };
}
export function clearDraft(id: string) { delete drafts.value[id]; }
