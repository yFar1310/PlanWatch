import {afterEach,describe,it,expect,vi} from 'vitest';
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils';
import CalendarChart from '../CalendarChart.vue';
import FullCalendar from '@fullcalendar/vue3';
import type {Task} from '../../shared/tasks';
let wrapper:VueWrapper|undefined;
const task:Task={id:'task-a',title:'Focus <img src=x onerror=alert(1)>',notes:null,status:'todo',priority:'high',dependsOn:null,dependencyTitle:null,dependencyStatus:null,plannedDate:'2026-10-20',plannedEndDate:null,startTime:'09:00',endTime:'10:00',estimateMinutes:null,actualMinutes:null,createdAt:1,updatedAt:1,completedAt:null,deletedAt:null,version:1};
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.restoreAllMocks();});
async function open(){wrapper=mount(CalendarChart,{attachTo:document.body,props:{items:[task],from:'2026-10-20',view:'day',disabled:false}});await flushPromises();return wrapper;}
describe('installed FullCalendar integration',()=>{
  it('mounts a Paris-aware day calendar with safe titles and keyboard editing',async()=>{
    const w=await open(),fc=w.getComponent(FullCalendar),calendar=fc.vm.getApi(),event=calendar.getEventById(task.id)!;
    expect(calendar.view.type).toBe('timeGridDay');expect(event.startStr).toBe('2026-10-20T09:00:00+02:00');expect(event.endStr).toBe('2026-10-20T10:00:00+02:00');expect(w.find('img').exists()).toBe(false);
    const element=w.find('[aria-label="Edit Focus <img src=x onerror=alert(1)>"]');expect(element.exists()).toBe(true);expect(element.attributes('title')).toContain('Click to edit');await element.trigger('keydown',{key:'Enter'});expect(w.emitted('edit')?.[0]?.[0]).toMatchObject({id:task.id});
  });
  it('switches Day, Week and Month in the real library without a premium layout plugin',async()=>{
    const w=await open(),calendar=w.getComponent(FullCalendar).vm.getApi();await w.setProps({view:'week'});expect(calendar.view.type).toBe('timeGridWeek');
    await w.setProps({view:'month'});expect(calendar.view.type).toBe('dayGridMonth');expect(w.find('.fc-daygrid').exists()).toBe(true);expect(calendar.view.activeStart.toISOString()).toBe('2026-09-27T22:00:00.000Z');expect(calendar.view.activeEnd.toISOString()).toBe('2026-11-08T23:00:00.000Z');
  });
  it('bridges resize and move callbacks, preserving the original version and rejecting overnight times',async()=>{
    const w=await open(),fc=w.getComponent(FullCalendar),event=fc.vm.getApi().getEventById(task.id)!;
    const options=fc.props('options')!,resize=options.eventResize as (info:unknown)=>void,drop=options.eventDrop as (info:unknown)=>void,revert=vi.fn();
    resize({event:{id:task.id,start:new Date('2026-10-20T08:00:00Z'),end:new Date('2026-10-20T09:15:00Z'),allDay:false},oldEvent:event,revert});
    expect(w.emitted('change')?.[0]?.[0]).toMatchObject({version:1,schedule:{startTime:'10:00',endTime:'11:15'}});
    drop({event:{id:task.id,start:new Date('2026-10-20T21:00:00Z'),end:new Date('2026-10-21T00:00:00Z'),allDay:false},oldEvent:event,revert});expect(revert).toHaveBeenCalledOnce();expect(w.emitted('failure')).toHaveLength(1);
    await w.setProps({disabled:true});resize({event,oldEvent:event,revert});expect(revert).toHaveBeenCalledTimes(2);expect(w.emitted('change')).toHaveLength(1);
  });
  it('passes the selected interval to capture without saving and converts all-day exclusive ends',async()=>{
    const w=await open(),fc=w.getComponent(FullCalendar),select=fc.props('options')!.select as (info:unknown)=>void;
    select({start:new Date('2026-10-20T07:15:00Z'),end:new Date('2026-10-20T08:45:00Z'),allDay:false});expect(w.emitted('plan')?.[0]).toEqual(['2026-10-20','09:15','10:45',undefined]);
    select({start:new Date('2026-10-24T22:00:00Z'),end:new Date('2026-10-26T23:00:00Z'),allDay:true});expect(w.emitted('plan')?.[1]).toEqual(['2026-10-25',undefined,undefined,'2026-10-26']);
    await w.setProps({disabled:true});select({start:new Date(),end:new Date(),allDay:true});expect(w.emitted('plan')).toHaveLength(2);
  });
});
