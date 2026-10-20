import { isCalendarDay } from './calendar';
import type { Task } from './tasks';
export interface Schedule { plannedDate: string | null; plannedEndDate: string | null; startTime: string | null; endTime: string | null }
export function scheduleProblem(value: Schedule): string | null {
  if (!value.plannedDate && (value.plannedEndDate || value.startTime || value.endTime)) return 'Choose a planned day before adding an end date or time.';
  if (value.plannedEndDate && value.plannedDate && value.plannedEndDate < value.plannedDate) return 'The end date must be on or after the planned day.';
  if (!!value.startTime !== !!value.endTime) return 'Choose both a start time and an end time, or clear both.';
  if (value.startTime && value.endTime) {
    if (value.endTime <= value.startTime) return 'The end time must be later than the start time.';
    if (value.plannedEndDate && value.plannedEndDate !== value.plannedDate) return 'Timed tasks must start and finish on the same day. Clear the times for a multi-day task.';
  }
  return null;
}
export function dayNumber(day: string): number { return Date.parse(`${day}T00:00:00Z`) / 86_400_000; }
export function shiftDay(day: string, amount: number): string {
  const result = new Date((dayNumber(day) + amount) * 86_400_000).toISOString().slice(0, 10);
  if (!isCalendarDay(result)) throw new Error('Choose a date between year 0001 and 9999.');
  return result;
}
export function weekStart(day: string): string { const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); return shiftDay(day, -(weekday + 6) % 7); }
export function minutes(time: string): number { const [hours, mins] = time.split(':').map(Number); return hours! * 60 + mins!; }
export interface TimedPlacement { task: Task; start: number; end: number; column: number; columns: number }
/** Overlapping appointments share columns; events touching at an endpoint do not overlap. */
export function placeTimed(tasks: Task[]): TimedPlacement[] {
  const sorted = tasks.filter(t => t.startTime && t.endTime).map(task => ({ task, start: minutes(task.startTime!), end: minutes(task.endTime!), column: 0, columns: 1 }))
    .sort((a,b) => a.start-b.start || a.end-b.end || a.task.id.localeCompare(b.task.id));
  let group: TimedPlacement[] = [], ends: number[] = [], groupEnd = -1;
  function finish() { for (const item of group) item.columns = ends.length; group = []; ends = []; }
  for (const item of sorted) {
    if (item.start >= groupEnd) finish();
    let column = ends.findIndex(end => end <= item.start);
    if (column === -1) column = ends.length;
    item.column = column; ends[column] = item.end; group.push(item); groupEnd = Math.max(item.end, group.length === 1 ? -1 : groupEnd);
  }
  finish(); return sorted;
}
