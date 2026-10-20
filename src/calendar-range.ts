import { dayNumber, shiftDay } from '../shared/scheduling';

export type CalendarView = 'day' | 'week' | 'month';
const minimum = dayNumber('0001-01-01'), maximum = dayNumber('9999-12-31');
function dateAt(value: number) { return new Date(Math.min(maximum, Math.max(minimum, value)) * 86400000).toISOString().slice(0,10); }
export function calendarRange(anchor: string, view: CalendarView) {
  if (view === 'day') return {from:anchor,to:anchor};
  const first = view === 'month' ? `${anchor.slice(0,7)}-01` : anchor;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = dayNumber(first) - (weekday + 6) % 7;
  return {from:dateAt(start),to:dateAt(start + (view === 'month' ? 41 : 6))};
}
export function moveCalendar(anchor: string, view: CalendarView, direction: number) {
  if (view !== 'month') return shiftDay(anchor, direction * (view === 'day' ? 1 : 7));
  const date = new Date(`${anchor.slice(0,7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  const next = date.getTime() / 86400000;
  if (next < minimum || next > maximum) throw new Error('Choose a date between year 0001 and 9999.');
  return dateAt(next);
}
