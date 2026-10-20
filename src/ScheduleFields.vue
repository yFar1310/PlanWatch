<script setup lang="ts">
import { watch } from 'vue';
import { TIME_ZONE, nextDay } from '../shared/calendar';
import { scheduleProblem } from '../shared/scheduling';
export interface ScheduleDraft { plannedDate:string; plannedEndDate:string; startTime:string; endTime:string }
const props=defineProps<{modelValue:ScheduleDraft;today:string;disabled?:boolean;includeStart?:boolean}>();
const emit=defineEmits<{'update:modelValue':[value:ScheduleDraft]}>();
function change(field:keyof ScheduleDraft,event:Event){emit('update:modelValue',{...props.modelValue,[field]:(event.target as HTMLInputElement).value});}
function setDay(day:string){emit('update:modelValue',{...props.modelValue,plannedDate:day,...(!day?{plannedEndDate:'',startTime:'',endTime:''}:{})});}
function timed(event:Event){emit('update:modelValue',{...props.modelValue,startTime:(event.target as HTMLInputElement).checked?'09:00':'',endTime:(event.target as HTMLInputElement).checked?'10:00':''});}
watch(()=>props.modelValue.plannedDate,day=>{if(!day&&(props.modelValue.plannedEndDate||props.modelValue.startTime||props.modelValue.endTime))setDay('');});
function problem(){const v=props.modelValue;return scheduleProblem({plannedDate:v.plannedDate||null,plannedEndDate:v.plannedEndDate||null,startTime:v.startTime||null,endTime:v.endTime||null});}
</script>
<template>
  <fieldset class="schedule-fields" :disabled="disabled">
    <template v-if="includeStart"><label>Planned day <span>optional</span><input :value="modelValue.plannedDate" type="date" min="0001-01-01" max="9999-12-31" @input="change('plannedDate',$event)" /></label><div class="date-shortcuts"><button class="date-chip" type="button" @click="setDay(today)">Today</button><button class="date-chip" type="button" @click="setDay(nextDay(today))">Tomorrow</button><button class="date-chip" type="button" @click="setDay('')">No date</button></div></template>
    <div class="schedule-grid"><label>End date <span>optional · inclusive</span><input :value="modelValue.plannedEndDate" type="date" :min="modelValue.plannedDate||'0001-01-01'" max="9999-12-31" :disabled="!modelValue.plannedDate" @input="change('plannedEndDate',$event)" /></label><label class="schedule-timed"><input type="checkbox" :checked="!!(modelValue.startTime||modelValue.endTime)" :disabled="!modelValue.plannedDate || (!!modelValue.plannedEndDate && modelValue.plannedEndDate!==modelValue.plannedDate && !modelValue.startTime)" @change="timed" /><span>Set a time · {{ TIME_ZONE }}</span></label></div>
    <div v-if="modelValue.startTime||modelValue.endTime" class="schedule-grid"><label>Start time<input :value="modelValue.startTime" type="time" step="60" required @input="change('startTime',$event)" /></label><label>End time<input :value="modelValue.endTime" type="time" step="60" required @input="change('endTime',$event)" /></label></div>
    <p v-if="problem()" class="schedule-error" role="alert">{{ problem() }}</p>
    <p v-else class="capture-hint">{{ modelValue.startTime ? 'A time slot within one day.' : 'Without a time, this task appears in the all-day row.' }}</p>
  </fieldset>
</template>
