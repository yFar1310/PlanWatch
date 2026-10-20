<script setup lang="ts">
import { computed,defineAsyncComponent,onErrorCaptured,onUnmounted,ref,watch } from 'vue';
import { CalendarDays,ChevronLeft,ChevronRight,Plus,RefreshCw } from '@lucide/vue';
import { currentDay,formatDay,isCalendarDay,TIME_ZONE } from '../shared/calendar';
import { scheduleProblem } from '../shared/scheduling';
import { priorities,type Task,type TimelinePage } from '../shared/tasks';
import { api,ApiError } from './api';
import { drafts } from './drafts';
import type { ScheduleChange } from './schedule-adapters';
import { calendarRange,moveCalendar,type CalendarView } from './calendar-range';
const CalendarChart=defineAsyncComponent({loader:()=>import('./CalendarChart.vue').then(module=>module.default),timeout:15000});
const props=defineProps<{revision:number;online:boolean;today:string}>();
const emit=defineEmits<{failure:[problem:unknown];edit:[task:Task];plan:[day:string,time?:string,endTime?:string,endDay?:string];browse:[]}>();
const scale=ref<CalendarView>('day'),anchor=ref(currentDay());
const chartError=ref(false),chartKey=ref(0);
onErrorCaptured(()=>{chartError.value=true;return false;});
const search=ref(''),priority=ref('all'),status=ref('all');
const items=ref<Task[]>([]),cursor=ref<string|null>(null),unscheduled=ref(0),loading=ref(false),saving=ref(false),error=ref(''),message=ref('');
let sequence=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
const range=computed(()=>calendarRange(anchor.value,scale.value));
const rangeLabel=computed(()=>scale.value==='month'
  ? new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${anchor.value}T00:00:00Z`))
  : range.value.from===range.value.to?formatDay(range.value.from):`${formatDay(range.value.from)} – ${formatDay(range.value.to)}`);
function openDay(day:string){anchor.value=day;scale.value='day';}
function fail(problem:unknown){if(disposed)return;error.value=problem instanceof Error?problem.message:'Could not update your schedule.';emit('failure',problem);}
async function load(append=false){
  const request=++sequence;loading.value=true;
  if(!props.online){loading.value=false;error.value='Reconnect to load your timeline.';return;}
  const query=new URLSearchParams({...range.value,q:search.value.trim(),priority:priority.value,status:status.value});
  if(append&&cursor.value)query.set('cursor',cursor.value);
  try{
    const page=await api<TimelinePage>(`/timeline?${query}`);
    if(disposed||request!==sequence)return;
    items.value=append?[...items.value,...page.items.filter(t=>!items.value.some(old=>old.id===t.id))]:page.items;
    cursor.value=page.nextCursor;unscheduled.value=page.unscheduledCount;
  }catch(problem){if(!disposed&&request===sequence)fail(problem);}
  finally{if(!disposed&&request===sequence)loading.value=false;}
}
async function reschedule(change:ScheduleChange){
  const task=items.value.find(item=>item.id===change.id);
  if(saving.value||loading.value||!props.online||!task){change.revert();return;}
  if(change.version!==task.version){change.revert();fail(new Error('This task changed while you were moving it. Check its current schedule before trying again.'));return;}
  if(drafts.value[task.id]){change.revert();fail(new Error('This task has an unsaved draft. Save or discard it in task details before moving it.'));return;}
  const problem=scheduleProblem(change.schedule);
  if(problem){change.revert();fail(new Error(problem));return;}
  if(['plannedDate','plannedEndDate','startTime','endTime'].every(key=>task[key as keyof Task]===change.schedule[key as keyof typeof change.schedule])){change.revert();return;}
  saving.value=true;error.value='';message.value='';
  try{
    const result=await api<{task:Task}>(`/tasks/${task.id}`,'PATCH',{version:task.version,...change.schedule});
    if(disposed)return;
    items.value=items.value.map(item=>item.id===task.id?result.task:item);
    message.value=`Schedule saved for ${result.task.title}.`;
    await load();
  }catch(problem){
    if(disposed)return;
    change.revert();fail(problem);
    // A timeout may have committed. Read once to reconcile, never replay a write.
    if(!(problem instanceof ApiError&&(problem.status===401||problem.status===403)))await load();
  }finally{if(!disposed)saving.value=false;}
}
watch([()=>range.value.from,()=>range.value.to,search,priority,status,()=>props.revision,()=>props.online],(values,old)=>{
  ++sequence;clearTimeout(timer);items.value=[];cursor.value=null;loading.value=true;error.value='';message.value='';
  timer=setTimeout(()=>{void load();},old&&old.length>0&&values[2]!==old[2]?250:0);
},{immediate:true});
function move(direction:number){try{anchor.value=moveCalendar(anchor.value,scale.value,direction);}catch{error.value='Choose a date between year 0001 and 9999.';}}
function jump(event:Event){const value=(event.target as HTMLInputElement).value;if(isCalendarDay(value))anchor.value=value;}
onUnmounted(()=>{disposed=true;++sequence;clearTimeout(timer);});
</script>

<template>
  <section class="timeline-view" aria-labelledby="timeline-title">
    <div class="heading-row"><div><p class="eyebrow">MAKE TIME FOR YOUR PLANS</p><h1 id="timeline-title">Calendar</h1><p class="intro">A clear place for your day · {{ TIME_ZONE }}</p></div><button title="Refresh calendar" class="icon-button" aria-label="Refresh calendar" :disabled="loading||saving" @click="load()"><RefreshCw :size="18" :class="{spin:loading}" /></button></div>
    <div class="timeline-toolbar"><button class="primary" :disabled="!online||saving" @click="emit('plan',anchor)"><Plus :size="16" />Plan a task</button><div class="timeline-navigation"><button title="Previous period" class="icon-button" aria-label="Previous period" :disabled="loading||saving" @click="move(-1)"><ChevronLeft :size="18" /></button><button class="secondary" :disabled="saving" @click="anchor=today">Today</button><button title="Next period" class="icon-button" aria-label="Next period" :disabled="loading||saving" @click="move(1)"><ChevronRight :size="18" /></button></div><label class="timeline-jump"><span class="sr-only">Jump to date</span><input :value="anchor" :disabled="saving" type="date" min="0001-01-01" max="9999-12-31" @change="jump" /></label><select v-model="scale" :disabled="saving" aria-label="Calendar view"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></div>
    <p class="timeline-range">{{ rangeLabel }}</p>
    <div class="timeline-filters"><label>Priority<select v-model="priority" :disabled="saving"><option value="all">All priorities</option><option v-for="value in priorities" :key="value" :value="value">{{ value }}</option></select></label><label>Status<select v-model="status" :disabled="saving"><option value="all">All tasks</option><option value="open">Open</option><option value="done">Done</option></select></label><label class="timeline-search"><span class="sr-only">Search timeline</span><input v-model="search" :disabled="saving" type="search" maxlength="200" placeholder="Search timeline…" /></label></div>
    <p v-if="error" role="alert" class="error-message">{{ error }} <button :disabled="loading||saving||!online" @click="load()">Try again</button></p>
    <p v-if="loading&&!items.length" role="status">Loading your schedule…</p>
    <p v-if="!loading&&!items.length&&!error" class="timeline-empty">Nothing planned in this period{{ search||priority!=='all'||status!=='all'?' with these filters':'' }}. Choose another period or plan a task.</p>
    <p class="schedule-help">Click an empty slot or drag across a free area to plan. Click a task to edit; drag to move it or resize its edge. On mobile, press and hold. Dates and times are saved only after confirmation or a move.</p>
    <p role="status" class="schedule-feedback">{{ saving ? 'Saving new schedule…' : message }}</p>
    <div v-if="chartError" role="alert" class="calendar-unavailable"><h2>The calendar could not load</h2><p>Your tasks are still saved. You can retry or edit their dates from the task list.</p><button class="secondary" @click="chartKey++;chartError=false">Retry calendar</button><button class="secondary" @click="emit('browse')">Open tasks</button></div>
    <CalendarChart v-else :key="chartKey" :items="items" :from="anchor" :view="scale" :disabled="loading||saving||!online" @change="reschedule" @edit="emit('edit',$event)" @plan="(day,time,endTime,endDay)=>emit('plan',day,time,endTime,endDay)" @day="openDay" @failure="fail" />
    <div v-if="items.length" class="schedule-accessible"><details><summary>Edit scheduled tasks without dragging</summary><button v-for="task in items" :key="task.id" class="secondary" :disabled="saving||loading" @click="emit('edit',task)">{{ task.title }} · {{ task.startTime ? `${task.startTime}–${task.endTime}` : 'All day' }}</button></details></div>
    <div class="timeline-bottom"><span>{{ items.length }} tasks shown{{ cursor?' · more available; load them to see the complete schedule':'' }}.</span><button v-if="cursor" class="secondary" :disabled="loading||saving||!online" @click="load(true)">Load more scheduled tasks</button></div>
    <div v-if="unscheduled" class="connection-banner"><CalendarDays :size="18" /><span>{{ unscheduled }} matching {{ unscheduled===1?'task has':'tasks have' }} no planned day.</span><button class="secondary" @click="emit('browse')">Open tasks to schedule</button></div>
  </section>
</template>
