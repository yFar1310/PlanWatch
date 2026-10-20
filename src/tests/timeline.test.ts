import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {flushPromises,mount,type VueWrapper} from '@vue/test-utils';
import TimelineView from '../TimelineView.vue';
import {setAuthTokenProvider} from '../api';
import {dayNumber,placeTimed,scheduleProblem,shiftDay,weekStart} from '../../shared/scheduling';
import type {Task} from '../../shared/tasks';
function task(id:string,extra:Partial<Task>={}):Task{return{id,title:id,notes:null,status:'todo',priority:'medium',dependsOn:null,dependencyTitle:null,dependencyStatus:null,plannedDate:'2026-10-20',plannedEndDate:null,startTime:null,endTime:null,estimateMinutes:null,actualMinutes:null,createdAt:1,updatedAt:1,completedAt:null,deletedAt:null,version:1,...extra};}
let wrapper:VueWrapper|undefined;
const fetchMock=vi.fn();
function json(value:unknown){return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});}
async function settle(){await vi.advanceTimersByTimeAsync(0);await flushPromises();}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));setAuthTokenProvider(null);vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset().mockResolvedValue(json({items:[],nextCursor:null,unscheduledCount:0}));});
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.useRealTimers();vi.unstubAllGlobals();});
describe('timeline and calendar interactions',()=>{
  it('shows date spans and dependencies and opens the actual task for editing',async()=>{
    const parent=task('parent',{title:'Prepare outline',plannedDate:'2026-10-18',plannedEndDate:'2026-10-21'}),child=task('child',{title:'Write chapter',plannedDate:'2026-10-22',plannedEndDate:'2026-10-25',dependsOn:parent.id,dependencyTitle:parent.title});
    fetchMock.mockResolvedValue(json({items:[parent,child],nextCursor:null,unscheduledCount:2}));
    wrapper=mount(TimelineView,{props:{revision:0,online:true,today:'2026-10-20'}});await settle();
    const url=new URL(fetchMock.mock.calls[0]![0],'https://example.test');expect(url.searchParams.get('from')).toBe('2026-10-19');expect(url.searchParams.get('to')).toBe('2026-10-25');
    expect(wrapper.findAll('.gantt-bar')).toHaveLength(2);expect(wrapper.find('.gantt-arrows path').exists()).toBe(true);expect(wrapper.text()).toContain('2 matching tasks have no planned day');
    await wrapper.findAll('.gantt-bar')[1]!.trigger('click');expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({id:'child',dependsOn:'parent'});
  });
  it('renders overlapping timed appointments and all-day tasks in separate calendar areas',async()=>{
    fetchMock.mockResolvedValue(json({items:[task('first',{startTime:'09:00',endTime:'10:00'}),task('second',{startTime:'09:30',endTime:'10:30'}),task('all-day',{plannedEndDate:'2026-10-22'})],nextCursor:null,unscheduledCount:0}));
    wrapper=mount(TimelineView,{props:{revision:0,online:true,today:'2026-10-20'}});await settle();
    await wrapper.findAll('button').find(b=>b.text()==='Calendar')!.trigger('click');await settle();
    const timed=wrapper.findAll('.timed-event');expect(timed).toHaveLength(2);expect(timed[0]!.attributes('style')).toContain('50%');expect(timed[1]!.attributes('style')).toContain('50%');
    expect(wrapper.findAll('.all-day-event')).toHaveLength(3);
    expect((wrapper.get('.calendar-time-scroll').element as HTMLElement).scrollTop).toBe(384);
    await timed[0]!.trigger('click');expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({id:'first'});
    wrapper.findAll('.calendar-slot')[1]!.element.dispatchEvent(new MouseEvent('click',{detail:0,bubbles:true}));await flushPromises();expect(wrapper.emitted('plan')?.[0]).toEqual(['2026-10-20','09:00']);
  });
  it('loads the next server page and changes period/filter scope without mixing old tasks',async()=>{
    let page=0;fetchMock.mockImplementation(async()=>json(++page===1?{items:[task('first')],nextCursor:'next-page',unscheduledCount:0}:{items:[task('second')],nextCursor:null,unscheduledCount:0}));
    wrapper=mount(TimelineView,{props:{revision:0,online:true,today:'2026-10-20'}});await settle();
    await wrapper.findAll('button').find(b=>b.text()==='Load more scheduled tasks')!.trigger('click');await flushPromises();expect(wrapper.findAll('.gantt-bar')).toHaveLength(2);expect(fetchMock.mock.calls[1]![0]).toContain('cursor=next-page');
    fetchMock.mockResolvedValue(json({items:[],nextCursor:null,unscheduledCount:0}));await wrapper.get('[aria-label="Next period"]').trigger('click');await settle();expect(wrapper.findAll('.gantt-bar')).toHaveLength(0);expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('from=2026-10-26');
  });
});
describe('schedule arithmetic',()=>{
  it('keeps calendar days stable across both Paris daylight-saving transitions',()=>{
    expect(shiftDay('2026-03-29',1)).toBe('2026-03-30');expect(shiftDay('2026-10-25',1)).toBe('2026-10-26');expect(weekStart('2026-10-25')).toBe('2026-10-19');expect(dayNumber('2026-10-26')-dayNumber('2026-10-25')).toBe(1);
  });
  it('allocates overlap columns per connected group and reuses them for touching events',()=>{
    const result=placeTimed([task('a',{startTime:'09:00',endTime:'12:00'}),task('b',{startTime:'09:30',endTime:'10:00'}),task('c',{startTime:'09:45',endTime:'10:30'}),task('d',{startTime:'12:00',endTime:'13:00'})]);
    expect(result.map(item=>[item.task.id,item.column,item.columns])).toEqual([['a',0,3],['b',1,3],['c',2,3],['d',0,1]]);
    expect(scheduleProblem({plannedDate:'2026-10-20',plannedEndDate:null,startTime:'10:00',endTime:'09:00'})).not.toBeNull();
  });
});
