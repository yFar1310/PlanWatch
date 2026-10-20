import { isCalendarDay, TIME_ZONE } from '../shared/calendar';
import { scheduleProblem, shiftDay, type Schedule } from '../shared/scheduling';
import type { Task } from '../shared/tasks';

export interface ScheduleChange { id: string; version: number; schedule: Schedule; revert: () => void }
/** DHTMLX displays floating wall-clock dates. Never serialize these via toISOString(). */
export function floatingDate(day: string, time = '00:00'): Date {
  const [year, month, date] = day.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const result = new Date(0);
  result.setFullYear(year!, month! - 1, date!); result.setHours(hour!, minute!, 0, 0);
  if (floatingParts(result).day !== day || floatingParts(result).time !== time) throw new Error('This hour cannot be displayed in this device’s time zone. Use the task details to edit it.');
  return result;
}
export function floatingParts(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: `${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}
export function parisParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return { day:`${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`,time:`${part('hour')}:${part('minute')}` };
}
/** Both libraries use an exclusive end; D1 stores inclusive all-day end dates. */
export function movedSchedule(start: Date, end: Date | null, allDay: boolean, parts = floatingParts): Schedule {
  if (!end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Choose a valid start and end.');
  const first = parts(start), last = parts(end);
  if (!isCalendarDay(first.day) || !isCalendarDay(last.day)) throw new Error('Choose a date between year 0001 and 9999.');
  const schedule: Schedule = allDay
    ? { plannedDate:first.day,plannedEndDate:shiftDay(last.day,-1),startTime:null,endTime:null }
    : { plannedDate:first.day,plannedEndDate:null,startTime:first.time,endTime:last.time };
  if (!allDay && first.day !== last.day) throw new Error('Timed tasks must finish on the same day. Open the task to plan a multi-day task without times.');
  const problem = scheduleProblem(schedule); if (problem) throw new Error(problem);
  return schedule;
}
export function ganttDates(task: Task) {
  return { start_date:floatingDate(task.plannedDate!,task.startTime || '00:00'),end_date:task.startTime ? floatingDate(task.plannedDate!,task.endTime!) : floatingDate(shiftDay(task.plannedEndDate || task.plannedDate!,1)) };
}
export function calendarEvent(task: Task) {
  return { id:task.id,title:task.title,allDay:!task.startTime,
    start:task.startTime ? `${task.plannedDate}T${task.startTime}:00` : task.plannedDate!,
    end:task.startTime ? `${task.plannedDate}T${task.endTime}:00` : shiftDay(task.plannedEndDate || task.plannedDate!,1),
    classNames:[`priority-${task.priority}`, ...(task.status==='done'?['task-is-done']:[])],
    extendedProps:{taskId:task.id,version:task.version} };
}
