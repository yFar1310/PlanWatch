import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils';
import ScheduleProposalDialog from '../ScheduleProposalDialog.vue';
import {setAuthTokenProvider} from '../api';
import type {Task} from '../../shared/tasks';
const task={id:'5f226100-5761-44d1-8ce0-e6ee0d400003',title:'Call mum',status:'todo',version:1,plannedDate:null,estimateMinutes:null} as Task;
let wrapper:VueWrapper|undefined;const fetchMock=vi.fn();
const preview={version:1,snapshot:12,slots:[{startTime:'18:00',endTime:'18:30'},{startTime:'18:30',endTime:'19:00'}],warnings:[],reason:null};
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
beforeEach(()=>{setAuthTokenProvider(null);vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();});
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.unstubAllGlobals();});
describe('explicit scheduling proposals',()=>{
  it('does not write while finding or selecting a slot, then confirms the selected proposal once',async()=>{
    fetchMock.mockImplementation(async(path:string)=>json(path.endsWith('/suggestions')?preview:{task:{...task,plannedDate:'2099-10-21',startTime:'18:30',endTime:'19:00',version:2}}));
    wrapper=mount(ScheduleProposalDialog,{props:{task,today:'2099-10-21',online:true}});expect(fetchMock).not.toHaveBeenCalled();await wrapper.get('form').trigger('submit');await flushPromises();
    await wrapper.get('input[value="18:30"]').setValue();expect(fetchMock.mock.calls).toHaveLength(1);expect(wrapper.text()).toContain('available window, margins and saved activity times');
    await wrapper.findAll('button').find(button=>button.text()==='Confirm this time')!.trigger('click');await flushPromises();expect(fetchMock.mock.calls[1]![0]).toBe('/api/planning/apply');expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({version:1,snapshot:12,candidateStart:'18:30'});expect(wrapper.emitted('scheduled')?.[0]?.[0]).toMatchObject({version:2});
  });
  it('invalidates old candidates when the requested duration changes',async()=>{
    fetchMock.mockImplementation(async()=>json(preview));wrapper=mount(ScheduleProposalDialog,{props:{task,today:'2099-10-21',online:true}});await wrapper.get('form').trigger('submit');await flushPromises();await wrapper.get('input[value="18:00"]').setValue();await wrapper.get('[aria-label="Activity duration"]').setValue(60);expect(wrapper.find('.planning-results').exists()).toBe(false);expect(wrapper.findAll('button').find(button=>button.text()==='Confirm this time')!.attributes('disabled')).toBeDefined();
  });
  it('clears stale proposals and reads the changed task without replaying a failed confirmation',async()=>{
    fetchMock.mockImplementation(async(path:string)=>path.endsWith('/suggestions')?json(preview):path.endsWith('/apply')?json({error:'planning_changed',message:'Your schedule changed.'},409):json({task:{...task,version:2}}));
    wrapper=mount(ScheduleProposalDialog,{props:{task,today:'2099-10-21',online:true}});await wrapper.get('form').trigger('submit');await flushPromises();await wrapper.get('input[value="18:00"]').setValue();await wrapper.findAll('button').find(button=>button.text()==='Confirm this time')!.trigger('click');await flushPromises();expect(wrapper.get('[role="alert"]').text()).toContain('schedule changed');expect(wrapper.find('.planning-results').exists()).toBe(false);expect(fetchMock.mock.calls.filter(([path])=>path.endsWith('/apply'))).toHaveLength(1);expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/tasks/${task.id}`);
  });
  it('forwards access failures and prevents offline requests',async()=>{
    fetchMock.mockImplementation(async()=>json({message:'Access paused.',error:'account_banned'},403));wrapper=mount(ScheduleProposalDialog,{props:{task,today:'2099-10-21',online:false}});await wrapper.get('form').trigger('submit');expect(fetchMock).not.toHaveBeenCalled();await wrapper.setProps({online:true});await wrapper.get('form').trigger('submit');await flushPromises();expect(wrapper.emitted('failure')).toHaveLength(1);expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
