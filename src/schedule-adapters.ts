import { isCalendarDay, TIME_ZONE } from '../shared/calendar';
import { scheduleProblem, shiftDay, type Schedule } from '../shared/scheduling';
import type { Task } from '../shared/tasks';

export interface ScheduleChange { id: string; version: number; schedule: Schedule; revert: () => void }
export function parisParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return { day:`${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`,time:`${part('hour')}:${part('minute')}` };
}
/** FullCalendar uses an exclusive end; D1 stores inclusive all-day end dates. */
export function movedSchedule(start: Date, end: Date | null, allDay: boolean, parts = parisParts): Schedule {
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
export function calendarEvent(task: Task) {
  return { id:task.id,title:task.title,allDay:!task.startTime,
    start:task.startTime ? `${task.plannedDate}T${task.startTime}:00` : task.plannedDate!,
    end:task.startTime ? `${task.plannedDate}T${task.endTime}:00` : shiftDay(task.plannedEndDate || task.plannedDate!,1),
    classNames:[`priority-${task.priority}`, ...(task.status==='done'?['task-is-done']:[])],
    extendedProps:{taskId:task.id,version:task.version} };
}
