<script setup lang="ts">
import { useDialogBackdrop } from './dialog-backdrop';
import { onMounted, onUnmounted, ref, useId } from 'vue';
const props=defineProps<{ title: string; description: string; busy?: boolean; confirmLabel?: string; cancelLabel?: string; danger?: boolean; error?:string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement | null>(null), cancel = ref<HTMLButtonElement | null>(null);
const id = useId();
const {backdropStart,backdropClick}=useDialogBackdrop(dialog,()=>!!props.busy,()=>emit('cancel'));
const previousFocus = document.activeElement;
onMounted(() => { if (typeof dialog.value?.showModal === 'function') dialog.value.showModal(); else dialog.value?.setAttribute('open',''); cancel.value?.focus(); });
onUnmounted(() => { if(previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); });
</script>
<template>
  <dialog ref="dialog" @pointerdown="backdropStart" @click="backdropClick" class="confirmation-dialog" :aria-labelledby="id" :aria-describedby="`${id}-description`" @cancel.prevent="!busy && emit('cancel')">
    <h2 :id="id">{{ title }}</h2><p :id="`${id}-description`">{{ description }}</p><p v-if="error" class="error-message" role="alert">{{ error }}</p><div class="confirmation-actions"><button ref="cancel" class="secondary" :disabled="busy" @click="emit('cancel')">{{ cancelLabel || 'Keep working' }}</button><button class="primary" :class="{ 'danger-confirm': danger }" :disabled="busy" @click="emit('confirm')">{{ busy ? 'Saving…' : (confirmLabel || 'Yes, mark as done') }}</button></div>
  </dialog>
</template>
