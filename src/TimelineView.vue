<script setup lang="ts">
import { computed,nextTick,onUnmounted,ref,watch } from 'vue';
import { CalendarDays,ChevronLeft,ChevronRight,Link2,Plus,RefreshCw } from '@lucide/vue';
import { currentDay,formatDay,isCalendarDay,TIME_ZONE } from '../shared/calendar';
import { dayNumber,minutes,placeTimed,shiftDay } from '../shared/scheduling';
import { priorities,type Task,type TimelinePage } from '../shared/tasks';
import { api } from './api';
const props=defineProps<{revision:number;online:boolean;today:string}>();
const emit=defineEmits<{failure:[problem:unknown];edit:[task:Task];plan:[day:string,time?:string];browse:[]}>();
const mode=ref<'gantt'|'calendar'>('gantt'),scale=ref<'day'|'week'>('day'),anchor=ref(currentDay());
const search=ref(''),priority=ref('all'),status=ref('all');
const items=ref<Task[]>([]),cursor=ref<string|null>(null),unscheduled=ref(0),loading=ref(false),error=ref('');
const timeScroller=ref<HTMLElement|null>(null);
const ganttScroller=ref<HTMLElement|null>(null);
let positionGantt=true;
const scrollbarWidth=ref(0);
let sequence=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
const range=computed(()=>{
  let from:string,to:string;
  if(mode.value==='gantt'&&scale.value==='day'){
    from=anchor.value;to=anchor.value;
  }else{
    const weekday=new Date(`${anchor.value}T00:00:00Z`).getUTCDay();const start=Math.max(dayNumber('0001-01-01'),dayNumber(anchor.value)-(weekday+6)%7);
    from=new Date(start*86400000).toISOString().slice(0,10);to=new Date(Math.min(start+6,dayNumber('9999-12-31'))*86400000).toISOString().slice(0,10);
  }
  return {from,to};
});
const days=computed(()=>Array.from({length:dayNumber(range.value.to)-dayNumber(range.value.from)+1},(_,index)=>shiftDay(range.value.from,index)));
const dayLabel=(day:string)=>new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${day}T00:00:00Z`));
const daily=computed(()=>mode.value==='gantt'&&scale.value==='day');
const ticks=computed(()=>daily.value?Array.from({length:24},(_,hour)=>`${String(hour).padStart(2,'0')}:00`):days.value);
const ganttColumns=computed(()=>`180px repeat(${ticks.value.length},minmax(${daily.value?40:64}px,1fr))`);
const calendarColumns=computed(()=>`56px repeat(${days.value.length},minmax(115px,1fr))`);
const dated=computed(()=>items.value.filter(task=>task.plannedDate));
function offset(day:string){return dayNumber(day)-dayNumber(range.value.from);}
function barStyle(task:Task){
  if(!daily.value)return{gridColumn:span(task)};
  const start=task.startTime?minutes(task.startTime):0,end=task.endTime?minutes(task.endTime):1440;
  return{position:'absolute' as const,left:`${start/1440*100}%`,width:`${(end-start)/1440*100}%`,minWidth:'6px',top:'16px',margin:'0'};
}
function span(task:Task){return `${Math.max(0,offset(task.plannedDate!))+1} / ${Math.min(days.value.length-1,offset(task.plannedEndDate||task.plannedDate!))+2}`;}
const arrows=computed(()=>dated.value.flatMap((task,index)=>{
  if(!task.dependsOn)return[];
  const parentIndex=dated.value.findIndex(parent=>parent.id===task.dependsOn);
  if(parentIndex<0)return[];
  const parent=dated.value[parentIndex]!;
  const x1=Math.max(8,Math.min(ticks.value.length*100-8,daily.value?(parent.endTime?minutes(parent.endTime)/60*100:2400)-8:(offset(parent.plannedEndDate||parent.plannedDate!)+1)*100-8));
  const x2=Math.max(8,Math.min(ticks.value.length*100-8,daily.value?(task.startTime?minutes(task.startTime)/60*100:0)+8:offset(task.plannedDate!)*100+8));
  const y1=parentIndex*60+30,y2=index*60+30,bend=Math.min(ticks.value.length*100-3,Math.max(x1+14,x2-14));
  return [{id:task.id,path:`M ${x1} ${y1} H ${bend} V ${y2} H ${x2}`}];
}));
function allDay(day:string){return items.value.filter(t=>!t.startTime&&t.plannedDate!<=day&&(t.plannedEndDate||t.plannedDate!)>=day);}
function appointments(day:string){return placeTimed(items.value.filter(t=>t.plannedDate===day&&t.startTime));}
function position(item:ReturnType<typeof placeTimed>[number]){return {top:`${item.start/60*48}px`,height:`${Math.max(20,(item.end-item.start)/60*48)}px`,left:`calc(${item.column/item.columns*100}% + 2px)`,width:`calc(${100/item.columns}% - 4px)`};}
async function load(append=false){
  const request=++sequence;loading.value=true;error.value='';
  if(!props.online){loading.value=false;error.value='Reconnect to load your timeline.';return;}
  const query=new URLSearchParams({...range.value,q:search.value.trim(),priority:priority.value,status:status.value});
  if(append&&cursor.value)query.set('cursor',cursor.value);
  try{
    const page=await api<TimelinePage>(`/timeline?${query}`);
    if(disposed||request!==sequence)return;
    items.value=append?[...items.value,...page.items.filter(t=>!items.value.some(old=>old.id===t.id))]:page.items;
    cursor.value=page.nextCursor;unscheduled.value=page.unscheduledCount;
    if(!append&&daily.value&&positionGantt){
      await nextTick();const scroller=ganttScroller.value;
      if(scroller&&!disposed&&request===sequence){
        const starts=items.value.filter(task=>task.startTime).map(task=>minutes(task.startTime!));
        const first=starts.length?Math.min(...starts):9*60;
        const track=Math.max(0,scroller.scrollWidth-180),maximum=Math.max(0,scroller.scrollWidth-scroller.clientWidth);
        scroller.scrollLeft=Math.min(maximum,track*Math.max(0,first-60)/1440);positionGantt=false;
      }
    }
  }catch(problem){if(!disposed&&request===sequence){error.value=problem instanceof Error?problem.message:'Could not load the timeline.';emit('failure',problem);}}
  finally{if(!disposed&&request===sequence)loading.value=false;}
}
watch([()=>range.value.from,()=>range.value.to,search,priority,status,()=>props.revision,()=>props.online],(values,old)=>{
  positionGantt=!old?.length||values.slice(0,5).some((value,index)=>value!==old[index]);
  ++sequence;clearTimeout(timer);items.value=[];cursor.value=null;loading.value=true;
  timer=setTimeout(()=>{void load();},old&&old.length>0&&values[2]!==old[2]?250:0);
},{immediate:true});
watch(mode,async value=>{if(value==='calendar'){await nextTick();if(timeScroller.value){timeScroller.value.scrollTop=8*48;scrollbarWidth.value=timeScroller.value.offsetWidth-timeScroller.value.clientWidth;}}});
function move(direction:number){
  try{
    anchor.value=shiftDay(anchor.value,direction*(daily.value?1:7));
  }catch{error.value='Choose a date between year 0001 and 9999.';}
}
function jump(event:Event){const value=(event.target as HTMLInputElement).value;if(isCalendarDay(value))anchor.value=value;}
function planAt(day:string,event:MouseEvent){const target=event.currentTarget as HTMLElement;const minute=event.detail===0?9*60:Math.min(23*60+30,Math.max(0,Math.floor((event.clientY-target.getBoundingClientRect().top)/48*2)*30));emit('plan',day,`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`);}
onUnmounted(()=>{disposed=true;++sequence;clearTimeout(timer);});
</script>

<template>
  <section class="timeline-view" aria-labelledby="timeline-title">
    <div class="heading-row"><div><p class="eyebrow">MAKE TIME FOR YOUR PLANS</p><h1 id="timeline-title">Timeline</h1><p class="intro">Your tasks across days and hours · {{ TIME_ZONE }}</p></div><button class="icon-button" aria-label="Refresh timeline" :disabled="loading" @click="load()"><RefreshCw :size="18" :class="{spin:loading}" /></button></div>
    <div class="timeline-toolbar"><div class="filters" aria-label="Timeline view"><button :class="{active:mode==='gantt'}" :aria-pressed="mode==='gantt'" @click="mode='gantt'">Gantt</button><button :class="{active:mode==='calendar'}" :aria-pressed="mode==='calendar'" @click="mode='calendar'">Calendar</button></div><select v-if="mode==='gantt'" v-model="scale" aria-label="Gantt range"><option value="day">Daily</option><option value="week">Weekly</option></select><div class="timeline-navigation"><button class="icon-button" aria-label="Previous period" :disabled="loading" @click="move(-1)"><ChevronLeft :size="18" /></button><button class="secondary" @click="anchor=today">Today</button><button class="icon-button" aria-label="Next period" :disabled="loading" @click="move(1)"><ChevronRight :size="18" /></button></div><label class="timeline-jump"><span class="sr-only">Jump to date</span><input :value="anchor" type="date" min="0001-01-01" max="9999-12-31" @change="jump" /></label><button class="primary" :disabled="!online" @click="emit('plan',anchor)"><Plus :size="16" />Plan a task</button></div>
    <p class="timeline-range">{{ range.from===range.to?formatDay(range.from):`${formatDay(range.from)} – ${formatDay(range.to)}` }}</p>
    <div class="timeline-filters"><label>Priority<select v-model="priority"><option value="all">All priorities</option><option v-for="value in priorities" :key="value" :value="value">{{ value }}</option></select></label><label>Status<select v-model="status"><option value="all">All tasks</option><option value="open">Open</option><option value="done">Done</option></select></label><label class="timeline-search"><span class="sr-only">Search timeline</span><input v-model="search" type="search" maxlength="200" placeholder="Search timeline…" /></label></div>
    <p v-if="error" role="alert" class="error-message">{{ error }} <button :disabled="loading||!online" @click="load()">Try again</button></p>
    <p v-if="loading&&!items.length" role="status">Loading your schedule…</p>
    <p v-if="!loading&&!items.length&&!error" class="timeline-empty">Nothing planned in this period{{ search||priority!=='all'||status!=='all'?' with these filters':'' }}. Choose another period or plan a task.</p>
    <div v-if="mode==='gantt'" ref="ganttScroller" class="gantt-scroll" :style="{'--gantt-days':ticks.length,'--gantt-cell-width':daily?'40px':'64px'}" tabindex="0" aria-label="Gantt chart. Scroll horizontally to explore the dates." :aria-busy="loading">
      <div class="gantt-header" :style="{gridTemplateColumns:ganttColumns}"><span class="gantt-name">Task</span><span v-for="tick in ticks" :key="tick" :class="{'is-today':!daily&&tick===today}">{{ daily?tick:dayLabel(tick) }}</span></div>
      <div class="gantt-body">
        <div v-for="task in dated" :key="task.id" class="gantt-row" :style="{gridTemplateColumns:ganttColumns}"><button class="gantt-name" :aria-label="`Edit ${task.title}`" @click="emit('edit',task)"><span class="gantt-task-title">{{ task.title }}</span><span class="gantt-task-meta"><span class="priority-badge" :data-priority="task.priority">{{ task.priority }}</span><span>{{ daily ? (task.startTime?`${task.startTime}–${task.endTime}`:'All day') : task.status==='done'?'Done':task.status==='doing'?'In progress':'To do' }}</span><Link2 v-if="task.dependsOn" :size="12" :aria-label="`Prerequisite: ${task.dependencyTitle||'unavailable'}`" /></span></button><div class="gantt-track" :style="{gridTemplateColumns:`repeat(${ticks.length},minmax(0,1fr))`}"><span v-for="(tick,index) in ticks" :key="tick" class="gantt-cell" :style="{gridColumn:index+1}" :class="{'is-today':!daily&&tick===today}"></span><button class="gantt-bar" :class="{'is-done':task.status==='done'}" :data-priority="task.priority" :style="barStyle(task)" :aria-label="`${task.title}: ${formatDay(task.plannedDate!)} to ${formatDay(task.plannedEndDate||task.plannedDate!)}${task.dependsOn?`, prerequisite ${task.dependencyTitle}`:''}`" @click="emit('edit',task)">{{ task.title }}</button></div></div>
        <svg v-if="arrows.length" class="gantt-arrows" :viewBox="`0 0 ${ticks.length*100} ${dated.length*60}`" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="gantt-dependency-head" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><polygon points="0 0, 5 2.5, 0 5" fill="var(--muted)" /></marker></defs><path v-for="arrow in arrows" :key="arrow.id" :d="arrow.path" marker-end="url(#gantt-dependency-head)" vector-effect="non-scaling-stroke" /></svg>
      </div>
    </div>
    <div v-else class="calendar-horizontal" tabindex="0" aria-label="Weekly calendar. Scroll horizontally for other days." :aria-busy="loading"><div class="calendar-inner" :style="{minWidth:`${56+days.length*115+scrollbarWidth}px`}">
      <div class="calendar-days" :style="{gridTemplateColumns:calendarColumns,paddingRight:`${scrollbarWidth}px`}"><span class="calendar-zone">Paris</span><span v-for="day in days" :key="day" :class="{'is-today':day===today}">{{ dayLabel(day) }}</span></div>
      <div class="calendar-all-day" :style="{gridTemplateColumns:calendarColumns,paddingRight:`${scrollbarWidth}px`}"><span class="calendar-zone">All day</span><div v-for="day in days" :key="day"><button v-for="task in allDay(day)" :key="task.id" class="calendar-event all-day-event" :data-priority="task.priority" :class="{'is-done':task.status==='done'}" :aria-label="`Edit ${task.title}, all day on ${dayLabel(day)}`" @click="emit('edit',task)">{{ task.title }}</button></div></div>
      <div ref="timeScroller" class="calendar-time-scroll"><div class="calendar-grid" :style="{gridTemplateColumns:calendarColumns}"><div class="calendar-hours"><span v-for="hour in 24" :key="hour" :style="{top:`${(hour-1)*48}px`}">{{ String(hour-1).padStart(2,'0') }}:00</span></div><div v-for="day in days" :key="day" class="calendar-day" :class="{'is-today':day===today}"><button class="calendar-slot" :disabled="!online" :aria-label="`Plan a task on ${dayLabel(day)}`" @click="planAt(day,$event)"></button><button v-for="appointment in appointments(day)" :key="appointment.task.id" class="calendar-event timed-event" :data-priority="appointment.task.priority" :class="{'is-done':appointment.task.status==='done'}" :style="position(appointment)" :aria-label="`Edit ${appointment.task.title}, ${appointment.task.startTime} to ${appointment.task.endTime}`" @click="emit('edit',appointment.task)"><strong>{{ appointment.task.title }}</strong><span>{{ appointment.task.startTime }}–{{ appointment.task.endTime }}</span></button></div></div></div>
    </div></div>
    <div class="timeline-bottom"><span>{{ items.length }} tasks shown{{ cursor?' · more available':'' }}. Click a task to edit its dates, times or details.</span><button v-if="cursor" class="secondary" :disabled="loading||!online" @click="load(true)">Load more scheduled tasks</button></div>
    <div v-if="unscheduled" class="connection-banner"><CalendarDays :size="18" /><span>{{ unscheduled }} matching {{ unscheduled===1?'task has':'tasks have' }} no planned day.</span><button class="secondary" @click="emit('browse')">Open tasks to schedule</button></div>
  </section>
</template>
