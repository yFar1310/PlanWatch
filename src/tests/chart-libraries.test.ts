import {afterEach,describe,it,expect,vi} from 'vitest';
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils';
import GanttChart from '../GanttChart.vue';
import CalendarChart from '../CalendarChart.vue';
import FullCalendar from '@fullcalendar/vue3';
import {Gantt} from 'dhtmlx-gantt/codebase/dhtmlxgantt.es.js';
import {floatingDate} from '../schedule-adapters';
import type {Task} from '../../shared/tasks';
let wrapper:VueWrapper|undefined;
const task:Task={id:'task-a',title:'Focus <img src=x onerror=alert(1)>',notes:null,status:'todo',priority:'high',dependsOn:null,dependencyTitle:null,dependencyStatus:null,plannedDate:'2026-10-20',plannedEndDate:null,startTime:'09:00',endTime:'10:00',estimateMinutes:null,actualMinutes:null,createdAt:1,updatedAt:1,completedAt:null,deletedAt:null,version:1};
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.restoreAllMocks();});
describe('installed chart libraries',()=>{
  it('mounts the real DHTMLX engine and safely renders task titles',async()=>{
    const factory=vi.spyOn(Gantt,'getGanttInstance');
    wrapper=mount(GanttChart,{attachTo:document.body,props:{items:[task],from:'2026-10-20',to:'2026-10-20',scale:'day',disabled:false}});await flushPromises();
    expect(wrapper.find('.gantt_container').exists()).toBe(true);expect(wrapper.find('img').exists()).toBe(false);expect(wrapper.emitted('failure')).toBeUndefined();
    const chart=factory.mock.results[0]!.value;
    expect(chart.getTask(task.id).text).toBe(task.title);
    expect(chart.templates.task_text(new Date(),new Date(),chart.getTask(task.id))).toContain('&lt;img');
    expect(wrapper.find('.gantt_task_scale').exists()).toBe(true);
  });
  it('bridges real Gantt drag and resize hooks with the original version and a working revert',async()=>{
    const factory=vi.spyOn(Gantt,'getGanttInstance');wrapper=mount(GanttChart,{attachTo:document.body,props:{items:[task],from:'2026-10-20',to:'2026-10-20',scale:'day',disabled:false}});await flushPromises();
    const chart=factory.mock.results[0]!.value;
    expect(chart.callEvent('onBeforeTaskDrag',[task.id,'resize',new Event('mousedown')])).toBe(true);
    chart.getTask(task.id).end_date=floatingDate('2026-10-20','10:15');chart.callEvent('onAfterTaskDrag',[task.id,'resize',new Event('mouseup')]);
    const change=wrapper.emitted('change')![0]![0] as {version:number;schedule:unknown;revert:()=>void};expect(change.version).toBe(1);expect(change.schedule).toMatchObject({startTime:'09:00',endTime:'10:15'});
    change.revert();expect(chart.getTask(task.id).end_date.getHours()).toBe(10);expect(chart.getTask(task.id).end_date.getMinutes()).toBe(0);
    await wrapper.setProps({disabled:true});expect(chart.callEvent('onBeforeTaskDrag',[task.id,'move',new Event('mousedown')])).toBe(false);
  });
  it('mounts FullCalendar with Paris-aware timed events and keyboard editing',async()=>{
    wrapper=mount(CalendarChart,{attachTo:document.body,props:{items:[task],from:'2026-10-19',disabled:false}});await flushPromises();
    const fc=wrapper.getComponent(FullCalendar),calendar=fc.vm.getApi(),event=calendar.getEventById(task.id)!;
    expect(event.startStr).toBe('2026-10-20T09:00:00+02:00');expect(event.endStr).toBe('2026-10-20T10:00:00+02:00');expect(wrapper.find('img').exists()).toBe(false);
    const eventElement=wrapper.find('[aria-label="Edit Focus <img src=x onerror=alert(1)>"]');expect(eventElement.exists()).toBe(true);await eventElement.trigger('keydown',{key:'Enter'});expect(wrapper.emitted('edit')?.[0]?.[0]).toMatchObject({id:task.id});
  });
  it('keeps an all-day Gantt move at midnight when its source day crosses a DST change',async()=>{
    const factory=vi.spyOn(Gantt,'getGanttInstance'),allDay={...task,plannedDate:'2026-10-25',startTime:null,endTime:null};
    wrapper=mount(GanttChart,{attachTo:document.body,props:{items:[allDay],from:'2026-10-19',to:'2026-10-25',scale:'week',disabled:false}});await flushPromises();const chart=factory.mock.results[0]!.value;
    chart.callEvent('onBeforeTaskDrag',[task.id,'move',new Event('mousedown')]);const moved=chart.getTask(task.id);moved.start_date=floatingDate('2026-10-26');moved.end_date=floatingDate('2026-10-27','01:00');
    expect(chart.callEvent('onBeforeTaskChanged',[task.id,'move',{},new Event('mouseup')])).toBe(true);chart.callEvent('onAfterTaskDrag',[task.id,'move',new Event('mouseup')]);
    expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({schedule:{plannedDate:'2026-10-26',plannedEndDate:'2026-10-26',startTime:null,endTime:null}});expect(moved.end_date.getHours()).toBe(0);
  });
  it('bridges FullCalendar resize callbacks, preserves the version and reverts invalid overnight changes',async()=>{
    wrapper=mount(CalendarChart,{attachTo:document.body,props:{items:[task],from:'2026-10-19',disabled:false}});await flushPromises();const fc=wrapper.getComponent(FullCalendar),event=fc.vm.getApi().getEventById(task.id)!;
    const options=fc.props('options')!,resize=options.eventResize as (info:unknown)=>void,revert=vi.fn();
    resize({event:{id:task.id,start:new Date('2026-10-20T08:00:00Z'),end:new Date('2026-10-20T09:15:00Z'),allDay:false},oldEvent:event,revert});
    expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({version:1,schedule:{startTime:'10:00',endTime:'11:15'}});
    resize({event:{id:task.id,start:new Date('2026-10-20T21:00:00Z'),end:new Date('2026-10-21T00:00:00Z'),allDay:false},oldEvent:event,revert});expect(revert).toHaveBeenCalledOnce();expect(wrapper.emitted('failure')).toHaveLength(1);
  });
});
