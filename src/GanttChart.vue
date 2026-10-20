<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { escapeHTML, Gantt, type GanttStatic } from 'dhtmlx-gantt/codebase/dhtmlxgantt.es.js';
import type { Task } from '../shared/tasks';
import { dayNumber,shiftDay } from '../shared/scheduling';
import { floatingDate,floatingParts,ganttDates,movedSchedule,type ScheduleChange } from './schedule-adapters';
const props=defineProps<{items:Task[];from:string;to:string;scale:'day'|'week';disabled:boolean}>();
const emit=defineEmits<{change:[change:ScheduleChange];edit:[task:Task];failure:[problem:unknown]}>();
const container=ref<HTMLElement|null>(null);
let chart:GanttStatic|undefined,observer:ResizeObserver|undefined,scope='',dragging=false;
let dragged:Task|undefined;
function render(){
  if(!chart)return;
  const key=`${props.from}:${props.to}:${props.scale}`, same=key===scope,scroll=chart.getScrollState();scope=key;
  try{
    chart.config.start_date=floatingDate(props.from);chart.config.end_date=floatingDate(shiftDay(props.to,1));
    chart.config.scales=props.scale==='day'?[{unit:'day',step:1,format:'%D %d %M'},{unit:'hour',step:1,format:'%H:%i'}]:[{unit:'day',step:1,format:'%D %d %M'}];
    chart.config.min_column_width=props.scale==='day'?64:105;
    chart.config.readonly=props.disabled;
    const data=props.items.map(task=>({id:task.id,text:task.title,...ganttDates(task),progress:task.status==='done'?1:0,priority:task.priority,completed:task.status==='done'}));
    const ids=new Set(data.map(task=>task.id));
    chart.clearAll();chart.parse({data,links:props.items.filter(task=>task.dependsOn&&ids.has(task.dependsOn)).map(task=>({id:task.id,source:task.dependsOn!,target:task.id,type:'0'}))});
    chart.render();
    if(same)chart.scrollTo(scroll.x,scroll.y);
    else if(props.scale==='day'){
      const first=props.items.filter(task=>task.startTime).map(task=>task.startTime!).sort()[0]||'09:00';
      chart.scrollTo(Math.max(0,chart.posFromDate(floatingDate(props.from,first))-64),0);
    }
  }catch(problem){emit('failure',problem);}
}
onMounted(()=>{
  chart=Gantt.getGanttInstance();
  Object.assign(chart.config,{columns:[{name:'text',label:'Task · double-click to edit',width:'*',tree:false,template:(task:{text:string})=>escapeHTML(task.text)}],grid_width:210,row_height:52,bar_height:30,scale_height:54,
    duration_unit:'minute',time_step:15,min_duration:15*60*1000,round_dnd_dates:false,drag_progress:false,drag_links:false,details_on_dblclick:false,details_on_create:false,show_progress:false,
    touch:true,touch_drag:450,keyboard_navigation:true,auto_scheduling:false,show_empty_state:false});
  chart.templates.task_class=(_s,_e,task)=>`priority-${task.priority}${task.completed?' task-is-done':''}`;
  // Titles are untrusted; both HTML-returning templates escape them explicitly.
  chart.templates.task_text=(_s,_e,task)=>escapeHTML(task.text);
  chart.attachEvent('onBeforeTaskDrag',(id)=>{
    const task=props.items.find(item=>item.id===String(id));
    if(props.disabled||!task)return false;
    chart!.config.time_step=task.startTime?15:1440;chart!.config.min_duration=(task.startTime?15:1440)*60000;dragged={...task};dragging=true;return true;
  });
  chart.attachEvent('onBeforeTaskChanged',(id,mode)=>{
    dragging=false;
    const original=dragged;if(!original||original.startTime)return true;
    // Minute-based durations cross 23/25-hour DST days. All-day moves preserve calendar days.
    const task=chart!.getTask(id),start=floatingParts(task.start_date!).day;
    task.start_date=floatingDate(start);
    task.end_date=mode==='move'?floatingDate(shiftDay(start,dayNumber(original.plannedEndDate||original.plannedDate!)-dayNumber(original.plannedDate!)+1)):floatingDate(floatingParts(task.end_date!).day);
    task.duration=chart!.calculateDuration({start_date:task.start_date!,end_date:task.end_date!});
    if(task.end_date<=task.start_date){dragged=undefined;return false;}return true;
  });
  chart.attachEvent('onAfterTaskDrag',(id)=>{
    dragging=false;const original=dragged;dragged=undefined;if(!original)return;
    try{const changed=chart!.getTask(id);emit('change',{id:original.id,version:original.version,schedule:movedSchedule(changed.start_date!,changed.end_date!,!original.startTime),revert:render});}
    catch(problem){render();emit('failure',problem);}
  });
  chart.attachEvent('onTaskDblClick',(id)=>{const task=props.items.find(item=>item.id===String(id));if(task&&!props.disabled)emit('edit',task);return false;});
  chart.attachEvent('onBeforeLightbox',()=>false);
  chart.attachEvent('onBeforeTaskAdd',()=>false);
  chart.attachEvent('onBeforeTaskDelete',()=>false);
  chart.attachEvent('onBeforeLinkAdd',()=>false);
  chart.attachEvent('onBeforeLinkDelete',()=>false);
  chart.init(container.value!);render();
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>{if(!dragging)chart?.setSizes();});observer.observe(container.value!);}
});
watch([()=>props.items,()=>props.from,()=>props.to,()=>props.scale],render);
watch(()=>props.disabled,value=>{if(chart){chart.config.readonly=value;chart.render();}});
onUnmounted(()=>{observer?.disconnect();chart?.destructor();chart=undefined;});
</script>
<template><div ref="container" class="library-gantt" aria-label="Interactive Gantt chart. Drag a bar to move it; drag its edges to resize. Double-click to edit details." /></template>
<style>@import 'dhtmlx-gantt/codebase/dhtmlxgantt.css' layer(vendor);</style>
