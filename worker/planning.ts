import {z} from 'zod';
import {currentDay,isCalendarDay,TIME_ZONE} from '../shared/calendar';
import {findSlots,type PlanningInput,type PlanningResult} from '../shared/planning';
import {minutes} from '../shared/scheduling';
import {getTask,Problem} from './tasks';
const time=z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const planningSchema=z.object({taskId:z.uuid(),version:z.number().int().positive(),day:z.string().refine(isCalendarDay),windowStart:time,windowEnd:time,durationMinutes:z.number().int().min(5).max(240),bufferMinutes:z.number().int().min(0).max(60)}).strict();
export const applyPlanningSchema=planningSchema.extend({snapshot:z.number().int().nonnegative(),candidateStart:time}).strict();
interface Scheduled {id:string;startTime:string|null;endTime:string|null}
export async function suggestions(db:D1Database,owner:string,input:PlanningInput):Promise<PlanningResult>{
  const now=new Date(),today=currentDay(now);
  if(input.day<today)throw new Problem('invalid_day','Choose today or a future day.');
  if(input.windowEnd<=input.windowStart)throw new Problem('invalid_window','The available window must finish later on the same day.');
  const task=await getTask(db,owner,input.taskId);
  if(task.version!==input.version)throw new Problem('version_conflict','This activity changed. Refresh it before asking for a time.',409);
  if(task.status==='done')throw new Problem('already_done','Reopen this activity before scheduling it.');
  const results=await db.batch([
    db.prepare(`SELECT id,start_time AS startTime,end_time AS endTime FROM tasks WHERE owner_id=? AND id<>? AND deleted_at IS NULL AND planned_date<=? AND COALESCE(planned_end_date,planned_date)>=? LIMIT 1001`).bind(owner,task.id,input.day,input.day),
    db.prepare('SELECT COALESCE(max(id),0) AS snapshot FROM task_events WHERE owner_id=?').bind(owner),
    db.prepare('SELECT planned_date AS day,COALESCE(planned_end_date,planned_date) AS endDay,end_time AS endTime,status FROM tasks WHERE owner_id=? AND id=? AND deleted_at IS NULL').bind(owner,task.dependsOn||''),
  ]);
  const rows=results[0].results as unknown as Scheduled[];
  if(rows.length>1000)throw new Problem('schedule_too_large','There are too many activities to check safely. Use the calendar to plan manually.');
  const snapshot=Number((results[1].results[0] as {snapshot:number}).snapshot),warnings:string[]=[];
  const untimed=rows.filter(row=>!row.startTime).length;
  if(untimed)warnings.push(`${untimed} other ${untimed===1?'activity has':'activities have'} a date without times. Check them before accepting; they do not reserve an exact slot.`);
  let earliest=0;
  if(input.day===today){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const value=(key:string)=>Number(parts.find(part=>part.type===key)!.value);
    earliest=value('hour')*60+value('minute')+(value('second')?1:0);
  }
  if(task.dependsOn){
    const parent=results[2].results[0] as {day:string|null;endDay:string|null;endTime:string|null;status:string}|undefined;
    if(!parent)throw new Problem('version_conflict','The prerequisite changed. Refresh this activity.',409);
    if(parent.status!=='done'){
      if(!parent.day||!parent.endDay||parent.endDay>input.day||(parent.endDay===input.day&&!parent.endTime))return {version:task.version,snapshot,slots:[],warnings,reason:'Plan or complete the prerequisite first. Its finish time must be known before this activity can follow it.'};
      if(parent.endDay===input.day)earliest=Math.max(earliest,minutes(parent.endTime!)+input.bufferMinutes);
      warnings.push('The prerequisite is scheduled earlier but is not complete yet. It must be completed before you finish this activity.');
    }
  }
  const busy=rows.filter((row):row is Scheduled&{startTime:string;endTime:string}=>!!row.startTime&&!!row.endTime);
  const slots=findSlots(input,busy,earliest);
  return {version:task.version,snapshot,slots,warnings,reason:slots.length?null:'No slot fits this duration and margin in the available window. Try a shorter activity or a different window.'};
}
export async function applySuggestion(db:D1Database,owner:string,input:z.infer<typeof applyPlanningSchema>){
  const proposal=await suggestions(db,owner,input);
  if(proposal.snapshot!==input.snapshot)throw new Problem('planning_changed','Your schedule changed. Find fresh suggestions before confirming.',409);
  const slot=proposal.slots.find(slot=>slot.startTime===input.candidateStart);
  if(!slot)throw new Problem('proposal_expired','This slot is no longer available. Find fresh suggestions.',409);
  // The history boundary and task version are checked in the same statement as the update.
  // Concurrent task creation/edit/deletion invalidates the proposal, including a prerequisite change.
  const result=await db.prepare(`UPDATE tasks SET planned_date=?,planned_end_date=NULL,start_time=?,end_time=?,estimate_minutes=?,updated_at=?,version=version+1
    WHERE owner_id=? AND id=? AND deleted_at IS NULL AND status<>'done' AND version=?
    AND COALESCE((SELECT max(id) FROM task_events WHERE owner_id=?),0)=?`)
    .bind(input.day,slot.startTime,slot.endTime,input.durationMinutes,Date.now(),owner,input.taskId,input.version,owner,input.snapshot).run();
  if(!result.meta.changes)throw new Problem('planning_changed','Your schedule changed. Find fresh suggestions before confirming.',409);
  return {task:await getTask(db,owner,input.taskId)};
}
