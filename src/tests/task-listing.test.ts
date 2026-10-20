import {describe,it,expect} from 'vitest';
import {mount} from '@vue/test-utils';
import TaskListing from '../TaskListing.vue';
import type {Task} from '../../shared/tasks';
const tasks=[{id:'b',title:'Beta',priority:'low',plannedDate:null,status:'done'},{id:'a',title:'Alpha',priority:'urgent',plannedDate:'2026-10-20',status:'todo'}] as Task[];
describe('TanStack task listing',()=>{
  it('preserves server order by default and sorts loaded rows by priority, date and title',async()=>{
    const wrapper=mount(TaskListing,{props:{tasks,disabled:false,hasMore:true},slots:{default:'<article class="row">{{ params.task.title }}</article>'}});
    const titles=()=>wrapper.findAll('.row').map(row=>row.text());expect(titles()).toEqual(['Beta','Alpha']);
    await wrapper.get('[aria-label="Sort tasks"]').setValue('priority');expect(titles()).toEqual(['Alpha','Beta']);expect(wrapper.text()).toContain('Sorting applies to loaded tasks');
    await wrapper.get('[aria-label="Sort tasks"]').setValue('plannedDate');expect(titles()).toEqual(['Alpha','Beta']);
    await wrapper.get('[aria-label="Sort tasks"]').setValue('title');expect(titles()).toEqual(['Alpha','Beta']);
    await wrapper.get('[aria-label="Sort descending"]').trigger('click');expect(titles()).toEqual(['Beta','Alpha']);
    await wrapper.setProps({tasks:[...tasks,{id:'c',title:'Charlie',priority:'medium',status:'doing'} as Task]});expect(titles()).toEqual(['Charlie','Beta','Alpha']);wrapper.unmount();
  });
});
