<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { CalendarOptions, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { TIME_ZONE } from '../shared/calendar';
import type { Task } from '../shared/tasks';
import { calendarEvent,movedSchedule,parisParts,type ScheduleChange } from './schedule-adapters';
const props=defineProps<{items:Task[];from:string;disabled:boolean}>();
const emit=defineEmits<{change:[change:ScheduleChange];edit:[task:Task];plan:[day:string,time?:string];failure:[problem:unknown]}>();
const calendar=ref<InstanceType<typeof FullCalendar>|null>(null);
function change(info:EventDropArg|EventResizeDoneArg){
  if(props.disabled){info.revert();return;}
  try{emit('change',{id:info.event.id,version:info.oldEvent.extendedProps.version,schedule:movedSchedule(info.event.start!,info.event.end,info.event.allDay,parisParts),revert:info.revert});}
  catch(problem){info.revert();emit('failure',problem);}
}
const events=computed(()=>props.items.map(calendarEvent));
const options=computed<CalendarOptions>(()=>({
  plugins:[timeGridPlugin,interactionPlugin,luxonPlugin],initialView:'timeGridWeek',initialDate:props.from,timeZone:TIME_ZONE,firstDay:1,headerToolbar:false,
  height:620,scrollTime:'08:00:00',slotDuration:'00:30:00',snapDuration:'00:15:00',slotLabelFormat:{hour:'2-digit',minute:'2-digit',hour12:false},eventTimeFormat:{hour:'2-digit',minute:'2-digit',hour12:false},
  editable:!props.disabled,eventResizableFromStart:true,allDayMaintainDuration:true,longPressDelay:450,nowIndicator:true,events:events.value,
  eventDrop:change,eventResize:change,
  eventAllow:(_drop,event)=>!props.disabled&&!!event,
  eventClick:info=>{const task=props.items.find(item=>item.id===info.event.id);if(task&&!props.disabled)emit('edit',task);},
  dateClick:info=>{if(!props.disabled){const parts=parisParts(info.date);emit('plan',parts.day,info.allDay?undefined:parts.time);}},
  eventDidMount:info=>{info.el.setAttribute('tabindex','0');info.el.setAttribute('role','button');info.el.setAttribute('aria-label',`Edit ${info.event.title}`);info.el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const task=props.items.find(item=>item.id===info.event.id);if(task&&!props.disabled)emit('edit',task);}};},
}));
watch(()=>props.from,date=>calendar.value?.getApi().gotoDate(date));
</script>
<template><div class="library-calendar"><FullCalendar ref="calendar" :options="options" /></div></template>
