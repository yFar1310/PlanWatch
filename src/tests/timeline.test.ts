import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {flushPromises,mount,type VueWrapper} from '@vue/test-utils';
import TimelineView from '../TimelineView.vue';
import {setAuthTokenProvider} from '../api';
import {drafts,fromTask} from '../drafts';
import {calendarEvent,movedSchedule,parisParts} from '../schedule-adapters';
import {calendarRange,moveCalendar} from '../calendar-range';
import {shiftDay,weekStart} from '../../shared/scheduling';
import type {Task} from '../../shared/tasks';
const chartState=vi.hoisted(()=>({fail:false}));
vi.mock('../CalendarChart.vue',()=>({default:{name:'CalendarChart',props:['items','from','view','disabled'],emits:['change','edit','plan','day','failure'],setup(){if(chartState.fail)throw new Error('Calendar failed to initialize');},template:'<div class="mock-calendar" />'}}));
export function task(id:string,extra:Partial<Task>={}):Task{return{id,title:id,notes:null,status:'todo',priority:'medium',dependsOn:null,dependencyTitle:null,dependencyStatus:null,plannedDate:'2026-10-20',plannedEndDate:null,startTime:null,endTime:null,estimateMinutes:null,actualMinutes:null,createdAt:1,updatedAt:1,completedAt:null,deletedAt:null,version:1,...extra};}
let wrapper:VueWrapper|undefined;
const fetchMock=vi.fn();
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
async function settle(){await vi.advanceTimersByTimeAsync(0);await flushPromises();}
async function open(items:Task[]=[task('focus',{startTime:'09:00',endTime:'10:00'})]){
 fetchMock.mockImplementation(async()=>json({items,nextCursor:null,unscheduledCount:0}));
 wrapper=mount(TimelineView,{props:{revision:0,online:true,today:'2026-10-20'}});await settle();return wrapper;
}
const schedule={plannedDate:'2026-10-20',plannedEndDate:null,startTime:'11:00',endTime:'12:00'};
beforeEach(()=>{chartState.fail=false;vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));setAuthTokenProvider(null);drafts.value={};vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();});
afterEach(()=>{wrapper?.unmount();wrapper=undefined;drafts.value={};vi.useRealTimers();vi.unstubAllGlobals();});
describe('library timeline orchestration',()=>{
 it('contains a chart initialization failure and retries without losing the surrounding page',async()=>{
  chartState.fail=true;const w=await open();expect(w.get('#timeline-title').text()).toBe('Calendar');expect(w.get('[role="alert"]').text()).toContain('The calendar could not load');expect(w.emitted('failure')).toBeUndefined();
  chartState.fail=false;await w.findAll('button').find(button=>button.text()==='Retry calendar')!.trigger('click');await flushPromises();expect(w.findComponent({name:'CalendarChart'}).exists()).toBe(true);expect(w.find('[role="alert"]').exists()).toBe(false);
 });
 it('defaults to a day calendar and queries a Monday-based week, keeping dependency data',async()=>{
  const w=await open([task('child',{dependsOn:'parent',dependencyTitle:'Prepare'})]);
  expect(w.getComponent({name:'CalendarChart'}).props()).toMatchObject({from:'2026-10-20',view:'day'});
  await w.get('[aria-label="Calendar view"]').setValue('week');await settle();
  expect(w.getComponent({name:'CalendarChart'}).props()).toMatchObject({from:'2026-10-20',view:'week'});
  expect(fetchMock.mock.calls.at(-1)![0]).toContain('from=2026-10-19&to=2026-10-25');
  const child=w.getComponent({name:'CalendarChart'}).props('items')[0];expect(child.dependsOn).toBe('parent');
  w.getComponent({name:'CalendarChart'}).vm.$emit('edit',child);expect(w.emitted('edit')?.[0]?.[0]).toMatchObject({id:'child'});
 });
 it('forwards empty-slot intervals and opens a selected day without a document navigation',async()=>{
  const w=await open(),url=window.location.href;
  const chart=w.getComponent({name:'CalendarChart'});chart.vm.$emit('plan','2026-10-21','09:30','10:45');expect(w.emitted('plan')?.[0]).toEqual(['2026-10-21','09:30','10:45',undefined]);
  chart.vm.$emit('day','2026-10-25');await settle();expect(chart.props()).toMatchObject({from:'2026-10-25',view:'day'});expect(window.location.href).toBe(url);
 });
 it('fetches every visible month cell including spillover days with at most 42 days',async()=>{
  const w=await open();await w.get('[aria-label="Calendar view"]').setValue('month');await settle();
  expect(fetchMock.mock.calls.at(-1)![0]).toContain('from=2026-09-28&to=2026-11-08');
  await w.get('[aria-label="Next period"]').trigger('click');await settle();expect(w.getComponent({name:'CalendarChart'}).props('from')).toBe('2026-11-01');
 });
 it('loads another page and clears old results when filters change',async()=>{
  let page=0;fetchMock.mockImplementation(async()=>json(++page===1?{items:[task('first')],nextCursor:'next-page',unscheduledCount:2}:{items:[task('second')],nextCursor:null,unscheduledCount:0}));
  wrapper=mount(TimelineView,{props:{revision:0,online:true,today:'2026-10-20'}});await settle();expect(wrapper.text()).toContain('2 matching tasks have no planned day');
  await wrapper.findAll('button').find(b=>b.text()==='Load more scheduled tasks')!.trigger('click');await flushPromises();expect(wrapper.getComponent({name:'CalendarChart'}).props('items')).toHaveLength(2);expect(fetchMock.mock.calls[1]![0]).toContain('cursor=next-page');
  fetchMock.mockImplementation(async()=>json({items:[],nextCursor:null,unscheduledCount:0}));await wrapper.get('[aria-label="Next period"]').trigger('click');await settle();expect(wrapper.getComponent({name:'CalendarChart'}).props('items')).toHaveLength(0);
 });
 it('saves only scheduling fields with the current version and refreshes the persisted result',async()=>{
  const w=await open([task('focus',{status:'done',version:7,startTime:'09:00',endTime:'10:00'})]);
  fetchMock.mockImplementation(async(_path:string,options:RequestInit)=>options.method==='PATCH'?json({task:task('focus',{...schedule,version:8,status:'done'})}):json({items:[task('focus',{...schedule,version:8,status:'done'})],nextCursor:null,unscheduledCount:0}));
  const revert=vi.fn();w.getComponent({name:'CalendarChart'}).vm.$emit('change',{id:'focus',version:7,schedule,revert});await flushPromises();
  const call=fetchMock.mock.calls.find(([,options])=>options.method==='PATCH')!;expect(JSON.parse(call[1].body)).toEqual({version:7,...schedule});expect(revert).not.toHaveBeenCalled();expect(w.getComponent({name:'CalendarChart'}).props('items')[0]).toMatchObject({version:8,status:'done',startTime:'11:00'});expect(w.text()).toContain('Schedule saved');
 });
 it('reverts conflicts, reads the authoritative schedule, and never retries the write',async()=>{
  const w=await open();fetchMock.mockImplementation(async(_path:string,options:RequestInit)=>options.method==='PATCH'?json({message:'Changed in another tab.',error:'version_conflict'},409):json({items:[task('focus',{version:2,startTime:'14:00',endTime:'15:00'})],nextCursor:null,unscheduledCount:0}));
  const revert=vi.fn();w.getComponent({name:'CalendarChart'}).vm.$emit('change',{id:'focus',version:1,schedule,revert});await flushPromises();expect(revert).toHaveBeenCalledOnce();expect(w.getComponent({name:'CalendarChart'}).props('items')[0].startTime).toBe('14:00');expect(w.get('[role="alert"]').text()).toContain('Changed in another tab');expect(fetchMock.mock.calls.filter(([,o])=>o.method==='PATCH')).toHaveLength(1);
 });
 it('rejects a second move while saving and disables navigation',async()=>{
  const w=await open();let complete!:(value:Response)=>void;fetchMock.mockImplementation(async(_path:string,options:RequestInit)=>options.method==='PATCH'?new Promise<Response>(resolve=>complete=resolve):json({items:[task('focus',{...schedule,version:2})],nextCursor:null,unscheduledCount:0}));
  const chart=w.getComponent({name:'CalendarChart'});chart.vm.$emit('change',{id:'focus',version:1,schedule,revert:vi.fn()});await flushPromises();expect(w.get('[aria-label="Next period"]').attributes('disabled')).toBeDefined();
  const revert=vi.fn();chart.vm.$emit('change',{id:'focus',version:1,schedule,revert});await flushPromises();expect(revert).toHaveBeenCalledOnce();expect(fetchMock.mock.calls.filter(([,o])=>o.method==='PATCH')).toHaveLength(1);complete(json({task:task('focus',{...schedule,version:2})}));await flushPromises();
 });
 it('protects an unsaved task draft and refuses offline writes',async()=>{
  const w=await open();drafts.value.focus=fromTask(task('focus'));const revert=vi.fn();w.getComponent({name:'CalendarChart'}).vm.$emit('change',{id:'focus',version:1,schedule,revert});await flushPromises();expect(w.text()).toContain('unsaved draft');expect(revert).toHaveBeenCalledOnce();expect(fetchMock.mock.calls.filter(([,o])=>o.method==='PATCH')).toHaveLength(0);
  drafts.value={};await w.setProps({online:false});await settle();w.getComponent({name:'CalendarChart'}).vm.$emit('change',{id:'focus',version:1,schedule,revert});await flushPromises();expect(fetchMock.mock.calls.filter(([,o])=>o.method==='PATCH')).toHaveLength(0);
 });
 it('forwards session failures without issuing another private read',async()=>{
  const w=await open();fetchMock.mockImplementation(async()=>json({error:'account_banned',message:'Access paused'},403));const before=fetchMock.mock.calls.length;
  const revert=vi.fn();w.getComponent({name:'CalendarChart'}).vm.$emit('change',{id:'focus',version:1,schedule,revert});await flushPromises();expect(w.emitted('failure')).toHaveLength(1);expect(revert).toHaveBeenCalledOnce();expect(fetchMock.mock.calls.length-before).toBe(1);
 });
});
describe('schedule adapters',()=>{
 it('converts inclusive all-day dates to exclusive ends across DST and back',()=>{const t=task('a',{plannedDate:'2026-10-24',plannedEndDate:'2026-10-26'});expect(calendarEvent(t).end).toBe('2026-10-27');expect(movedSchedule(new Date('2026-10-23T22:00:00Z'),new Date('2026-10-26T23:00:00Z'),true,parisParts)).toEqual({plannedDate:'2026-10-24',plannedEndDate:'2026-10-26',startTime:null,endTime:null});expect(shiftDay('2026-03-29',1)).toBe('2026-03-30');expect(weekStart('2026-10-25')).toBe('2026-10-19');});
 it('keeps calendar ranges bounded and changes months without overflowing the last day',()=>{expect(calendarRange('0001-01-01','month').from).toBe('0001-01-01');expect(calendarRange('9999-12-31','month').to).toBe('9999-12-31');expect(moveCalendar('2026-01-31','month',1)).toBe('2026-02-01');expect(()=>moveCalendar('9999-12-01','month',1)).toThrow('9999');});
 it('uses Paris hours rather than browser or UTC hours for calendar drops in summer and winter',()=>{expect(parisParts(new Date('2026-07-01T07:30:00Z'))).toEqual({day:'2026-07-01',time:'09:30'});expect(movedSchedule(new Date('2026-10-25T09:00:00Z'),new Date('2026-10-25T10:00:00Z'),false,parisParts)).toEqual({plannedDate:'2026-10-25',plannedEndDate:null,startTime:'10:00',endTime:'11:00'});});
 it('rejects overnight timed slots and invalid date ranges instead of silently changing their meaning',()=>{expect(()=>movedSchedule(new Date('2026-10-20T21:00:00Z'),new Date('2026-10-20T23:00:00Z'),false,parisParts)).toThrow('same day');expect(()=>movedSchedule(new Date('invalid'),new Date(),true)).toThrow('valid');expect(()=>movedSchedule(new Date('2026-10-20T00:00:00Z'),new Date('2026-10-20T00:00:00Z'),true,parisParts)).toThrow('valid');});
});
