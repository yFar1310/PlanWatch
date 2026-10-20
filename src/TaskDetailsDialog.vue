<script setup lang="ts">
import { useDialogBackdrop } from './dialog-backdrop';
import { onMounted,onUnmounted,ref,useId } from 'vue';
import { X } from '@lucide/vue';
import TaskEditor from './TaskEditor.vue';
import type { Task } from '../shared/tasks';
import type { TaskDraft } from './drafts';
const props=defineProps<{task:Task;busy:boolean;canSave:boolean;today:string;error:string}>();
const emit=defineEmits<{close:[];save:[draft:TaskDraft];delete:[];failure:[problem:unknown]}>();
const dialog=ref<HTMLDialogElement|null>(null),close=ref<HTMLButtonElement|null>(null),id=useId();
const {backdropStart,backdropClick}=useDialogBackdrop(dialog,()=>!!props.busy,()=>emit('close'));
const previous=document.activeElement;
onMounted(()=>{if(typeof dialog.value?.showModal==='function')dialog.value.showModal();else dialog.value?.setAttribute('open','');close.value?.focus();});
onUnmounted(()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();});
</script>
<template><dialog ref="dialog" @pointerdown="backdropStart" @click="backdropClick" class="task-dialog" :aria-labelledby="id" @cancel.prevent="!busy&&emit('close')"><header><h2 :id="id">Task details</h2><button title="Close task details" ref="close" type="button" class="icon-button" aria-label="Close task details" :disabled="busy" @click="emit('close')"><X :size="20" /></button></header><p v-if="error" role="alert" class="error-message">{{ error }}</p><TaskEditor :task="task" :disabled="busy" :can-save="canSave" :today="today" @save="emit('save',$event)" @delete="emit('delete')" @close="emit('close')" @failure="emit('failure',$event)" /></dialog></template>
