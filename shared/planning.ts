import {minutes} from './scheduling';
export interface PlanningInput {taskId:string;version:number;day:string;windowStart:string;windowEnd:string;durationMinutes:number;bufferMinutes:number}
export interface Slot {startTime:string;endTime:string}
export interface PlanningResult {version:number;snapshot:number;slots:Slot[];warnings:string[];reason:string|null}
export interface BusyInterval {startTime:string;endTime:string}
export function clockTime(value:number){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
/** Deterministic, bounded search. A 15-minute grid never rounds the requested duration down. */
export function findSlots(input:Pick<PlanningInput,'windowStart'|'windowEnd'|'durationMinutes'|'bufferMinutes'>,busy:BusyInterval[],earliest=0):Slot[]{
  const slots:Slot[]=[],from=Math.ceil(Math.max(minutes(input.windowStart),earliest)/15)*15,to=minutes(input.windowEnd);
  for(let start=from;start+input.durationMinutes<=to&&slots.length<3;start+=15){
    const end=start+input.durationMinutes;
    if(busy.some(item=>start<minutes(item.endTime)+input.bufferMinutes&&end>minutes(item.startTime)-input.bufferMinutes))continue;
    slots.push({startTime:clockTime(start),endTime:clockTime(end)});
    // Offer distinct alternatives, rather than three heavily overlapping copies of the same slot.
    start+=Math.max(0,Math.ceil(input.durationMinutes/15)*15-15);
  }
  return slots;
}
