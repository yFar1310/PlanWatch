import {beforeEach,describe,it,expect} from 'vitest';
import worker from '../worker';
import {testEnv} from './setup';
import {findSlots} from '../shared/planning';
const db=testEnv.DB;
async function api(path:string,method='POST',body?:unknown){const response=await worker.request(`/api${path}`,{method,headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})},testEnv);return {status:response.status,data:await response.json() as any};}
async function add(extra:Record<string,unknown>={}){const result=await api('/tasks','POST',{title:'An idea',...extra});expect(result.status).toBe(201);return result.data.task;}
function request(task:{id:string;version:number},extra:Record<string,unknown>={}){return {taskId:task.id,version:task.version,day:'2099-10-21',windowStart:'18:00',windowEnd:'22:00',durationMinutes:30,bufferMinutes:15,...extra};}
beforeEach(async()=>{await db.batch([db.prepare('DELETE FROM tasks'),db.prepare('DELETE FROM task_events'),db.prepare('DELETE FROM purged_tasks')]);});
describe('ideas and confirmed scheduling in D1',()=>{
  it('keeps ideas undated and filters the private inbox before pagination',async()=>{
    await add({title:'Undated'});await add({title:'Scheduled',plannedDate:'2099-10-21'});await add({title:'Already done',status:'done'});const deleted=await add({title:'Deleted'});await api(`/tasks/${deleted.id}`,'DELETE',{version:1});
    const result=await api('/tasks?view=ideas&status=all','GET');expect(result.data.items.map((task:any)=>task.title)).toEqual(['Undated']);
    const page=await api('/tasks?view=ideas&limit=1','GET');expect(page.data.items).toHaveLength(1);expect(page.data.nextCursor).toBeNull();
  });
  it('previews without a write and avoids overlapping timed tasks with the requested margin',async()=>{
    const idea=await add();await add({title:'Gym',plannedDate:'2099-10-21',startTime:'18:00',endTime:'19:00'});await add({title:'Untimed',plannedDate:'2099-10-21'});
    const before=await db.prepare('SELECT count(*) AS n FROM task_events').first<{n:number}>();const result=await api('/planning/suggestions','POST',request(idea));expect(result.status).toBe(200);expect(result.data.slots[0]).toEqual({startTime:'19:15',endTime:'19:45'});expect(result.data.warnings[0]).toContain('without times');
    expect((await db.prepare('SELECT count(*) AS n FROM task_events').first<{n:number}>())?.n).toBe(before?.n);expect((await api(`/tasks/${idea.id}`,'GET')).data.task.plannedDate).toBeNull();
  });
  it('confirms just the chosen activity and preserves status, priority, notes and prerequisite',async()=>{
    const parent=await add({status:'done'}),idea=await add({title:'Call mum',notes:'Keep this note',priority:'high',dependsOn:parent.id}),input=request(idea),preview=await api('/planning/suggestions','POST',input);
    const result=await api('/planning/apply','POST',{...input,snapshot:preview.data.snapshot,candidateStart:preview.data.slots[0].startTime});expect(result.status).toBe(200);expect(result.data.task).toMatchObject({plannedDate:'2099-10-21',plannedEndDate:null,startTime:'18:00',endTime:'18:30',estimateMinutes:30,status:'todo',priority:'high',notes:'Keep this note',dependsOn:parent.id,version:2});
    const events=await db.prepare('SELECT after_json FROM task_events WHERE task_id=? ORDER BY id DESC LIMIT 1').bind(idea.id).first<{after_json:string}>();expect(JSON.parse(events!.after_json)).toMatchObject({startTime:'18:00',version:2});expect((await api('/tasks?view=ideas','GET')).data.items).toEqual([]);
  });
  it('refuses a stale preview after another activity occupies its slot',async()=>{
    const idea=await add(),input=request(idea),preview=await api('/planning/suggestions','POST',input);await add({plannedDate:input.day,startTime:'18:00',endTime:'20:00'});
    const result=await api('/planning/apply','POST',{...input,snapshot:preview.data.snapshot,candidateStart:'18:00'});expect(result.status).toBe(409);expect(result.data.error).toBe('planning_changed');expect((await api(`/tasks/${idea.id}`,'GET')).data.task.plannedDate).toBeNull();
  });
  it('permits only one of two concurrent confirmations of the same free slot',async()=>{
    const first=await add(),second=await add(),one=request(first),two=request(second),a=await api('/planning/suggestions','POST',one),b=await api('/planning/suggestions','POST',two);
    const results=await Promise.all([api('/planning/apply','POST',{...one,snapshot:a.data.snapshot,candidateStart:'18:00'}),api('/planning/apply','POST',{...two,snapshot:b.data.snapshot,candidateStart:'18:00'})]);expect(results.map(result=>result.status).sort()).toEqual([200,409]);
    expect((await db.prepare('SELECT count(*) AS n FROM tasks WHERE start_time IS NOT NULL').first<{n:number}>())?.n).toBe(1);
  });
  it('rejects changed task versions, fabricated candidates, past dates and invalid windows',async()=>{
    const idea=await add(),input=request(idea),preview=await api('/planning/suggestions','POST',input);
    expect((await api('/planning/apply','POST',{...input,snapshot:preview.data.snapshot,candidateStart:'17:00'})).data.error).toBe('proposal_expired');
    for(const extra of [{day:'2000-01-01'},{windowEnd:'17:00'},{durationMinutes:0},{durationMinutes:241},{bufferMinutes:-1},{windowStart:'25:00'}])expect((await api('/planning/suggestions','POST',{...input,...extra})).status).toBe(400);
    await api(`/tasks/${idea.id}`,'PATCH',{version:1,title:'Changed'});expect((await api('/planning/suggestions','POST',input)).status).toBe(409);
  });
  it('requires an unfinished prerequisite to have a known earlier finish',async()=>{
    const parent=await add(),idea=await add({dependsOn:parent.id});let result=await api('/planning/suggestions','POST',request(idea));expect(result.data.slots).toEqual([]);expect(result.data.reason).toContain('prerequisite');
    await api(`/tasks/${parent.id}`,'PATCH',{version:1,plannedDate:'2099-10-21',startTime:'19:00',endTime:'20:00'});result=await api('/planning/suggestions','POST',request(idea));expect(result.data.slots[0].startTime).toBe('20:15');
  });
  it('rolls back a confirmed schedule if its history write fails',async()=>{
    const idea=await add(),input=request(idea),preview=await api('/planning/suggestions','POST',input);
    await db.prepare("CREATE TRIGGER reject_plan BEFORE INSERT ON task_events WHEN NEW.kind='updated' BEGIN SELECT RAISE(ABORT,'probe_history_failure'); END").run();
    try{expect((await api('/planning/apply','POST',{...input,snapshot:preview.data.snapshot,candidateStart:'18:00'})).status).toBe(500);}finally{await db.prepare('DROP TRIGGER reject_plan').run();}
    expect((await api(`/tasks/${idea.id}`,'GET')).data.task).toMatchObject({plannedDate:null,version:1});
  });
});
describe('bounded slot arithmetic',()=>{
  it('offers distinct alternatives, accepts touching boundaries without a margin and never crosses midnight',()=>{
    expect(findSlots({windowStart:'18:00',windowEnd:'20:00',durationMinutes:30,bufferMinutes:0},[{startTime:'17:30',endTime:'18:00'}])).toEqual([{startTime:'18:00',endTime:'18:30'},{startTime:'18:30',endTime:'19:00'},{startTime:'19:00',endTime:'19:30'}]);
    expect(findSlots({windowStart:'23:30',windowEnd:'23:59',durationMinutes:30,bufferMinutes:0},[])).toEqual([]);
    expect(findSlots({windowStart:'18:00',windowEnd:'20:00',durationMinutes:30,bufferMinutes:0},[],18*60+1)[0]?.startTime).toBe('18:15');
  });
});
