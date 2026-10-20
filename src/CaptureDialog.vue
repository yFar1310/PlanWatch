<script setup lang="ts">
import {onMounted,onUnmounted,ref,useId} from 'vue';
import {X} from '@lucide/vue';
import {priorities} from '../shared/tasks';
import type {CaptureDraft} from './drafts';
import ScheduleFields from './ScheduleFields.vue';
import DependencyPicker from './DependencyPicker.vue';
const props=defineProps<{modelValue:CaptureDraft;today:string;busy:boolean;canSave:boolean;error:string}>();
const emit=defineEmits<{'update:modelValue':[draft:CaptureDraft];close:[];add:[];failure:[problem:unknown]}>();
const dialog=ref<HTMLDialogElement|null>(null),titleInput=ref<HTMLInputElement|null>(null),id=useId();
const previous=document.activeElement;
function patch(value:Partial<CaptureDraft>){emit('update:modelValue',{...props.modelValue,...value});}
onMounted(()=>{if(typeof dialog.value?.showModal==='function')dialog.value.showModal();else dialog.value?.setAttribute('open','');titleInput.value?.focus();});
onUnmounted(()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();});
</script>
<template><dialog ref="dialog" class="task-dialog" :aria-labelledby="id" @cancel.prevent="!busy&&emit('close')"><header><h2 :id="id">Plan a task</h2><button class="icon-button" type="button" aria-label="Cancel planned task" :disabled="busy" @click="emit('close')"><X :size="20" /></button></header><p v-if="error" role="alert" class="error-message">{{ error }}</p><form @submit.prevent="emit('add')"><fieldset class="calendar-capture-fields" :disabled="busy"><label>Task title<input ref="titleInput" :value="modelValue.title" maxlength="200" required @input="patch({title:($event.target as HTMLInputElement).value})" /></label><label>Priority<select :value="modelValue.priority" @change="patch({priority:($event.target as HTMLSelectElement).value as CaptureDraft['priority']})"><option v-for="priority in priorities" :key="priority" :value="priority">{{ priority }}</option></select></label><ScheduleFields :model-value="modelValue" :today="today" include-start @update:model-value="patch($event)" /><DependencyPicker :model-value="modelValue.dependsOn" :disabled="busy||!canSave" @update:model-value="patch({dependsOn:$event})" @failure="emit('failure',$event)" /><p class="capture-hint">Your draft is kept on this device if you close this window.</p><div class="confirmation-actions"><button class="secondary" type="button" @click="emit('close')">Cancel</button><button class="primary" :disabled="!canSave||!modelValue.title.trim()" type="submit">{{ busy?'Saving…':'Add task' }}</button></div></fieldset></form></dialog></template>
