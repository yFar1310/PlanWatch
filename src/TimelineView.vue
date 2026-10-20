<script setup lang="ts">
import { computed,defineAsyncComponent,onUnmounted,ref,watch } from 'vue';
import { CalendarDays,ChevronLeft,ChevronRight,Plus,RefreshCw } from '@lucide/vue';
import { currentDay,formatDay,isCalendarDay,TIME_ZONE } from '../shared/calendar';
import { dayNumber,scheduleProblem,shiftDay } from '../shared/scheduling';
import { priorities,type Task,type TimelinePage } from '../shared/tasks';
import { api,ApiError } from './api';
import { drafts } from './drafts';
import type { ScheduleChange } from './schedule-adapters';
const GanttChart=defineAsyncComponent(()=>import('./GanttChart.vue').then(module=>module.default));
const CalendarChart=defineAsyncComponent(()=>import('./CalendarChart.vue').then(module=>module.default));
const props=defineProps<{revision:number;online:boolean;today:string}>();
const emit=defineEmits<{failure:[problem:unknown];edit:[task:Task];plan:[day:string,time?:string];browse:[]}>();
const mode=ref<'gantt'|'calendar'>('gantt'),scale=ref<'day'|'week'>('day'),anchor=ref(currentDay());
const search=ref(''),priority=ref('all'),status=ref('all');
const items=ref<Task[]>([]),cursor=ref<string|null>(null),unscheduled=ref(0),loading=ref(false),saving=ref(false),error=ref(''),message=ref('');
let sequence=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
const daily=computed(()=>mode.value==='gantt'&&scale.value==='day');
const range=computed(()=>{
  if(daily.value)return {from:anchor.value,to:anchor.value};
  const weekday=new Date(`${anchor.value}T00:00:00Z`).getUTCDay(),start=Math.max(dayNumber('0001-01-01'),dayNumber(anchor.value)-(weekday+6)%7);
  return {from:new Date(start*86400000).toISOString().slice(0,10),to:new Date(Math.min(start+6,dayNumber('9999-12-31'))*86400000).toISOString().slice(0,10)};
});
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
function move(direction:number){try{anchor.value=shiftDay(anchor.value,direction*(daily.value?1:7));}catch{error.value='Choose a date between year 0001 and 9999.';}}
function jump(event:Event){const value=(event.target as HTMLInputElement).value;if(isCalendarDay(value))anchor.value=value;}
onUnmounted(()=>{disposed=true;++sequence;clearTimeout(timer);});
</script>

<template>
  <section class="timeline-view" aria-labelledby="timeline-title">
    <div class="heading-row"><div><p class="eyebrow">MAKE TIME FOR YOUR PLANS</p><h1 id="timeline-title">Timeline</h1><p class="intro">Your tasks across days and hours · {{ TIME_ZONE }}</p></div><button class="icon-button" aria-label="Refresh timeline" :disabled="loading||saving" @click="load()"><RefreshCw :size="18" :class="{spin:loading}" /></button></div>
    <div class="timeline-toolbar"><div class="filters" aria-label="Timeline view"><button :class="{active:mode==='gantt'}" :aria-pressed="mode==='gantt'" :disabled="saving" @click="mode='gantt'">Gantt</button><button :class="{active:mode==='calendar'}" :aria-pressed="mode==='calendar'" :disabled="saving" @click="mode='calendar'">Calendar</button></div><select v-if="mode==='gantt'" v-model="scale" :disabled="saving" aria-label="Gantt range"><option value="day">Daily</option><option value="week">Weekly</option></select><div class="timeline-navigation"><button class="icon-button" aria-label="Previous period" :disabled="loading||saving" @click="move(-1)"><ChevronLeft :size="18" /></button><button class="secondary" :disabled="saving" @click="anchor=today">Today</button><button class="icon-button" aria-label="Next period" :disabled="loading||saving" @click="move(1)"><ChevronRight :size="18" /></button></div><label class="timeline-jump"><span class="sr-only">Jump to date</span><input :value="anchor" :disabled="saving" type="date" min="0001-01-01" max="9999-12-31" @change="jump" /></label><button class="primary" :disabled="!online||saving" @click="emit('plan',anchor)"><Plus :size="16" />Plan a task</button></div>
    <p class="timeline-range">{{ range.from===range.to?formatDay(range.from):`${formatDay(range.from)} – ${formatDay(range.to)}` }}</p>
    <div class="timeline-filters"><label>Priority<select v-model="priority" :disabled="saving"><option value="all">All priorities</option><option v-for="value in priorities" :key="value" :value="value">{{ value }}</option></select></label><label>Status<select v-model="status" :disabled="saving"><option value="all">All tasks</option><option value="open">Open</option><option value="done">Done</option></select></label><label class="timeline-search"><span class="sr-only">Search timeline</span><input v-model="search" :disabled="saving" type="search" maxlength="200" placeholder="Search timeline…" /></label></div>
    <p v-if="error" role="alert" class="error-message">{{ error }} <button :disabled="loading||saving||!online" @click="load()">Try again</button></p>
    <p v-if="loading&&!items.length" role="status">Loading your schedule…</p>
    <p v-if="!loading&&!items.length&&!error" class="timeline-empty">Nothing planned in this period{{ search||priority!=='all'||status!=='all'?' with these filters':'' }}. Choose another period or plan a task.</p>
    <p class="schedule-help">Drag a bar to move a task; drag its edges to change its duration. On mobile, press and hold. Use the task details for precise times or prerequisites.</p>
    <p role="status" class="schedule-feedback">{{ saving ? 'Saving new schedule…' : message }}</p>
    <GanttChart v-if="mode==='gantt'" :items="items" :from="range.from" :to="range.to" :scale="scale" :disabled="loading||saving||!online" @change="reschedule" @edit="emit('edit',$event)" @failure="fail" />
    <CalendarChart v-else :items="items" :from="range.from" :disabled="loading||saving||!online" @change="reschedule" @edit="emit('edit',$event)" @plan="(day,time)=>emit('plan',day,time)" @failure="fail" />
    <div v-if="items.length" class="schedule-accessible"><details><summary>Edit scheduled tasks without dragging</summary><button v-for="task in items" :key="task.id" class="secondary" :disabled="saving||loading" @click="emit('edit',task)">{{ task.title }} · {{ task.startTime ? `${task.startTime}–${task.endTime}` : 'All day' }}</button></details></div>
    <div class="timeline-bottom"><span>{{ items.length }} tasks shown{{ cursor?' · more available':'' }}. Double-click a Gantt task or click a calendar event to edit its details.</span><button v-if="cursor" class="secondary" :disabled="loading||saving||!online" @click="load(true)">Load more scheduled tasks</button></div>
    <div v-if="unscheduled" class="connection-banner"><CalendarDays :size="18" /><span>{{ unscheduled }} matching {{ unscheduled===1?'task has':'tasks have' }} no planned day.</span><button class="secondary" @click="emit('browse')">Open tasks to schedule</button></div>
  </section>
</template>
