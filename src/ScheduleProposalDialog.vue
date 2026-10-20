<script setup lang="ts">
import { useDialogBackdrop } from './dialog-backdrop';
import {computed,onMounted,onUnmounted,ref,useId,watch} from 'vue';
import {Clock3,Lightbulb,X} from '@lucide/vue';
import type {Task} from '../shared/tasks';
import type {PlanningInput,PlanningResult} from '../shared/planning';
import {TIME_ZONE,formatDay} from '../shared/calendar';
import {api,ApiError} from './api';
const props=defineProps<{task:Task;today:string;online:boolean}>();
const emit=defineEmits<{close:[];scheduled:[task:Task];failure:[problem:unknown]}>();
const current=ref(props.task),day=ref(props.today),windowStart=ref('18:00'),windowEnd=ref('22:00'),duration=ref(Math.min(240,Math.max(5,props.task.estimateMinutes||30))),buffer=ref(15);
const result=ref<PlanningResult|null>(null),selected=ref(''),busy=ref(false),error=ref('');
const dialog=ref<HTMLDialogElement|null>(null),dayInput=ref<HTMLInputElement|null>(null),id=useId();
let disposed=false,sequence=0;const {backdropStart,backdropClick}=useDialogBackdrop(dialog,()=>!!busy.value,()=>emit('close'));
const previous=document.activeElement;
const valid=computed(()=>!!day.value&&day.value>=props.today&&windowEnd.value>windowStart.value&&Number.isInteger(duration.value)&&duration.value>=5&&duration.value<=240&&Number.isInteger(buffer.value)&&buffer.value>=0&&buffer.value<=60);
function input():PlanningInput{return {taskId:current.value.id,version:current.value.version,day:day.value,windowStart:windowStart.value,windowEnd:windowEnd.value,durationMinutes:duration.value,bufferMinutes:buffer.value};}
watch([day,windowStart,windowEnd,duration,buffer],()=>{result.value=null;selected.value='';error.value='';++sequence;});
watch(()=>props.online,()=>{result.value=null;selected.value='';++sequence;});
async function fail(problem:unknown,reconcile=false){
  if(disposed)return;error.value=problem instanceof Error?problem.message:'Could not find a time. Please try again.';result.value=null;selected.value='';
  if(problem instanceof ApiError&&(problem.status===401||problem.status===403)){emit('failure',problem);return;}
  if(reconcile){try{const latest=await api<{task:Task}>(`/tasks/${current.value.id}`);if(!disposed)current.value=latest.task;}catch(failure){if(failure instanceof ApiError&&(failure.status===401||failure.status===403))emit('failure',failure);}}
}
async function find(){
  if(busy.value||!props.online||!valid.value)return;const request=++sequence;busy.value=true;error.value='';result.value=null;selected.value='';
  try{const response=await api<PlanningResult>('/planning/suggestions','POST',input());if(!disposed&&request===sequence)result.value=response;}
  catch(problem){await fail(problem,problem instanceof ApiError&&problem.status===409);}
  finally{if(!disposed)busy.value=false;}
}
async function confirm(){
  if(busy.value||!props.online||!valid.value||!result.value||!selected.value)return;
  busy.value=true;error.value='';
  try{const saved=await api<{task:Task}>('/planning/apply','POST',{...input(),snapshot:result.value.snapshot,candidateStart:selected.value});if(!disposed)emit('scheduled',saved.task);}
  catch(problem){await fail(problem,!(problem instanceof ApiError)||(problem.status===409));}
  finally{if(!disposed)busy.value=false;}
}
onMounted(()=>{if(typeof dialog.value?.showModal==='function')dialog.value.showModal();else dialog.value?.setAttribute('open','');dayInput.value?.focus();});
onUnmounted(()=>{disposed=true;++sequence;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();});
</script>
<template>
  <dialog ref="dialog" @pointerdown="backdropStart" @click="backdropClick" class="task-dialog planning-dialog" :aria-labelledby="id" @cancel.prevent="!busy&&emit('close')">
    <header><div><p class="eyebrow">OPTIONAL SCHEDULING HELP</p><h2 :id="id">Find available times</h2></div><button title="Close time suggestions" class="icon-button" aria-label="Close time suggestions" :disabled="busy" @click="emit('close')"><X :size="20" /></button></header>
    <p class="planning-task-title">{{ current.title }}</p>
    <p class="capture-hint">This activity is already saved. You can close this window without choosing anything. Enter a window you can actually use, excluding work and travel. The search checks your saved timed activities · {{ TIME_ZONE }}.</p>
    <p v-if="current.startTime" class="planning-current">Currently planned: {{ formatDay(current.plannedDate!) }} · {{ current.startTime }}–{{ current.endTime }}</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p><p v-if="!online" class="error-message" role="status">Reconnect to find and confirm a time.</p>
    <form @submit.prevent="find"><fieldset class="planning-fields" :disabled="busy"><div class="schedule-grid"><label>Day<input ref="dayInput" v-model="day" aria-label="Suggestion day" type="date" :min="today" max="9999-12-31" required /></label><label>Duration · minutes<input v-model.number="duration" aria-label="Activity duration" type="number" min="5" max="240" step="1" required /></label><label>Available from<input v-model="windowStart" aria-label="Available from" type="time" required /></label><label>Until<input v-model="windowEnd" aria-label="Available until" type="time" required /></label><label>Margin between activities<select v-model.number="buffer" aria-label="Margin between activities"><option :value="0">No margin</option><option :value="5">5 minutes</option><option :value="15">15 minutes</option><option :value="30">30 minutes</option><option :value="60">1 hour</option></select></label></div><button class="secondary" type="submit" :disabled="!valid||!online||current.status==='done'"><Lightbulb :size="16" />{{ busy?'Working…':'Show available times' }}</button></fieldset></form>
    <section v-if="result" class="planning-results" aria-label="Time suggestions"><p class="planning-method">These are the first available times in your window, in chronological order, using your margins and saved activity times. This is a free-slot search, not personalized AI advice. Untimed tasks and external calendars do not reserve time here.</p><p v-for="warning in result.warnings" :key="warning" class="planning-warning">{{ warning }}</p><p v-if="result.reason" role="status">{{ result.reason }}</p><fieldset v-if="result.slots.length" class="planning-slots" :disabled="busy"><legend>Choose a time only if you want to schedule now</legend><label v-for="slot in result.slots" :key="slot.startTime" :class="{selected:selected===slot.startTime}"><input v-model="selected" type="radio" name="suggested-time" :value="slot.startTime" /><Clock3 :size="17" /><span><strong>{{ slot.startTime }}–{{ slot.endTime }}</strong><small>{{ duration }} minutes · {{ buffer }}-minute margin around known activities</small></span></label></fieldset></section>
    <p class="capture-hint">Only this activity will be scheduled. Existing activities stay in place.</p>
    <div class="confirmation-actions"><button class="secondary" :disabled="busy" @click="emit('close')">Close without scheduling</button><button class="primary" :disabled="busy||!online||!selected||!result" @click="confirm">{{ busy?'Working…':'Confirm this time' }}</button></div>
  </dialog>
</template>
