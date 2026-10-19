import { ref, watch } from 'vue';
import type { Task } from '../shared/tasks';
import { currentDay, isCalendarDay } from '../shared/calendar';

export interface TaskDraft {
  title: string;
  notes: string;
  status: Task['status'];
  plannedDate: string;
  estimate: string;
  actual: string;
  version: number;
}
interface CaptureDraft { title: string; plannedDate: string; key: string | null; payload: string | null }
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
    && ['todo', 'doing', 'done'].includes(String(value.status)) && Number.isSafeInteger(value.version) && Number(value.version) > 0;
}
const stored = read(draftKey);
export const drafts = ref<Record<string, TaskDraft>>(record(stored) ? Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, TaskDraft] => isDraft(entry[1]))) : {});
const savedCapture = read(captureKey);
export const capture = ref<CaptureDraft>(record(savedCapture) && typeof savedCapture.title === 'string'
  && typeof savedCapture.plannedDate === 'string' && (!savedCapture.plannedDate || isCalendarDay(savedCapture.plannedDate))
  ? { title: savedCapture.title, plannedDate: savedCapture.plannedDate, key: typeof savedCapture.key === 'string' ? savedCapture.key : null, payload: typeof savedCapture.payload === 'string' ? savedCapture.payload : null }
  : { title: '', plannedDate: currentDay(), key: null, payload: null });
watch(drafts, () => write(draftKey, drafts.value), { deep: true, flush: 'sync' });
watch(capture, () => write(captureKey, capture.value), { deep: true, flush: 'sync' });

export function fromTask(task: Task): TaskDraft {
  return { title: task.title, notes: task.notes ?? '', status: task.status, plannedDate: task.plannedDate ?? '', estimate: task.estimateMinutes?.toString() ?? '', actual: task.actualMinutes?.toString() ?? '', version: task.version };
}
export function clearDraft(id: string) { delete drafts.value[id]; }
