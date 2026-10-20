<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { CalendarOptions, DateSelectArg, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { TIME_ZONE } from '../shared/calendar';
import type { Task } from '../shared/tasks';
import { calendarEvent,movedSchedule,parisParts,type ScheduleChange } from './schedule-adapters';
import type { CalendarView } from './calendar-range';
const props=defineProps<{items:Task[];from:string;view:CalendarView;disabled:boolean}>();
const emit=defineEmits<{change:[change:ScheduleChange];edit:[task:Task];plan:[day:string,time?:string,endTime?:string,endDay?:string];day:[day:string];failure:[problem:unknown]}>();
const calendar=ref<InstanceType<typeof FullCalendar>|null>(null);
const views={day:'timeGridDay',week:'timeGridWeek',month:'dayGridMonth'};
function select(info:DateSelectArg){
  calendar.value?.getApi().unselect();
  if(props.disabled)return;
  try{const schedule=movedSchedule(info.start,info.end,info.allDay,parisParts);emit('plan',schedule.plannedDate!,schedule.startTime||undefined,schedule.endTime||undefined,schedule.plannedEndDate||undefined);}
  catch(problem){emit('failure',problem);}
}
function change(info:EventDropArg|EventResizeDoneArg){
  if(props.disabled){info.revert();return;}
  try{emit('change',{id:info.event.id,version:info.oldEvent.extendedProps.version,schedule:movedSchedule(info.event.start!,info.event.end,info.event.allDay,parisParts),revert:info.revert});}
  catch(problem){info.revert();emit('failure',problem);}
}
const events=computed(()=>props.items.map(calendarEvent));
const options=computed<CalendarOptions>(()=>({
  plugins:[timeGridPlugin,dayGridPlugin,interactionPlugin,luxonPlugin],initialView:views[props.view],initialDate:props.from,timeZone:TIME_ZONE,firstDay:1,headerToolbar:false,
  height:680,scrollTime:'08:00:00',slotDuration:'00:30:00',snapDuration:'00:15:00',slotLabelFormat:{hour:'2-digit',minute:'2-digit',hour12:false},eventTimeFormat:{hour:'2-digit',minute:'2-digit',hour12:false},
  fixedWeekCount:true,dayMaxEvents:3,allDayText:'All day',selectable:!props.disabled,selectMirror:true,select,navLinks:true,
  navLinkDayClick:(date,event)=>{event.preventDefault();if(!props.disabled)emit('day',parisParts(date).day);},
  editable:!props.disabled,eventResizableFromStart:true,allDayMaintainDuration:true,longPressDelay:450,nowIndicator:true,events:events.value,
  eventDrop:change,eventResize:change,
  eventAllow:(_drop,event)=>!props.disabled&&!!event,
  eventClick:info=>{info.jsEvent.preventDefault();const task=props.items.find(item=>item.id===info.event.id);if(task&&!props.disabled)emit('edit',task);},
  eventDidMount:info=>{info.el.setAttribute('tabindex','0');info.el.setAttribute('role','button');info.el.setAttribute('aria-label',`Edit ${info.event.title}`);info.el.title=`${info.event.title} · ${info.event.allDay?'All day':info.timeText} · Click to edit`;info.el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const task=props.items.find(item=>item.id===info.event.id);if(task&&!props.disabled)emit('edit',task);}};},
}));
watch([()=>props.from,()=>props.view],()=>calendar.value?.getApi().changeView(views[props.view],props.from));
</script>
<template><div class="library-calendar" :class="`calendar-${view}`"><FullCalendar ref="calendar" :options="options" /></div></template>
