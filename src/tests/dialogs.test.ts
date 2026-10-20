import {afterEach,describe,it,expect,vi} from 'vitest';
import {mount,type VueWrapper} from '@vue/test-utils';
import type {Component} from 'vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import CaptureDialog from '../CaptureDialog.vue';
import TaskDetailsDialog from '../TaskDetailsDialog.vue';
import ScheduleProposalDialog from '../ScheduleProposalDialog.vue';
import UserGuideDialog from '../UserGuideDialog.vue';
import {capture,drafts,fromTask} from '../drafts';
import type {Task} from '../../shared/tasks';
const task:Task={id:'idea',title:'A walk',notes:null,status:'todo',priority:'medium',dependsOn:null,dependencyTitle:null,dependencyStatus:null,plannedDate:null,plannedEndDate:null,startTime:null,endTime:null,estimateMinutes:null,actualMinutes:null,createdAt:1,updatedAt:1,completedAt:null,deletedAt:null,version:1};
let wrapper:VueWrapper|undefined;
afterEach(()=>{wrapper?.unmount();wrapper=undefined;drafts.value={};vi.restoreAllMocks();});
function rect(w:VueWrapper){vi.spyOn(w.get('dialog').element,'getBoundingClientRect').mockReturnValue({left:100,right:500,top:100,bottom:500,width:400,height:400,x:100,y:100,toJSON:()=>({})});}
async function click(w:VueWrapper,x:number,y:number,startX=x,startY=y){const el=w.get('dialog').element;el.dispatchEvent(new MouseEvent('pointerdown',{button:0,bubbles:true,clientX:startX,clientY:startY}));el.dispatchEvent(new MouseEvent('click',{button:0,bubbles:true,clientX:x,clientY:y}));}
const cases:{name:string;component:Component;props:Record<string,unknown>;close:string}[]=[
 {name:'confirmation',component:ConfirmDialog,props:{title:'Sign out?',description:'Confirm',busy:false},close:'cancel'},
 {name:'capture',component:CaptureDialog,props:{modelValue:capture.value,today:'2026-10-21',busy:false,canSave:true,error:''},close:'close'},
 {name:'details',component:TaskDetailsDialog,props:{task,today:'2026-10-21',busy:false,canSave:true,error:''},close:'close'},
 {name:'suggestions',component:ScheduleProposalDialog,props:{task,today:'2026-10-21',online:true},close:'close'},
 {name:'guide',component:UserGuideDialog,props:{},close:'close'},
];
describe('dialog light dismiss',()=>{
 it.each(cases)('closes $name only when a primary click starts and ends outside',async({component,props,close})=>{
  wrapper=mount(component,{props});rect(wrapper);
  await click(wrapper,110,110);expect(wrapper.emitted(close)).toBeUndefined();
  await click(wrapper,20,20,200,200);expect(wrapper.emitted(close)).toBeUndefined();
  await click(wrapper,20,20);expect(wrapper.emitted(close)).toHaveLength(1);expect(wrapper.emitted('confirm')).toBeUndefined();
 });
 it('does not cancel a pending save and never confirms from the backdrop',async()=>{
  wrapper=mount(ConfirmDialog,{props:{title:'Done?',description:'Confirm',busy:true}});rect(wrapper);await click(wrapper,20,20);await wrapper.get('dialog').trigger('cancel');expect(wrapper.emitted('cancel')).toBeUndefined();expect(wrapper.emitted('confirm')).toBeUndefined();
  await wrapper.setProps({busy:false});await click(wrapper,20,20);expect(wrapper.emitted('cancel')).toHaveLength(1);
 });
 it('keeps an existing task draft when the details are dismissed',async()=>{
  drafts.value.idea={...fromTask(task),title:'A longer walk'};wrapper=mount(TaskDetailsDialog,{props:{task,today:'2026-10-21',busy:false,canSave:true,error:''}});rect(wrapper);await click(wrapper,20,20);wrapper.unmount();wrapper=undefined;expect(drafts.value.idea?.title).toBe('A longer walk');
 });
});
