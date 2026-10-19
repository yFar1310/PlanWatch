<template>
  <Modal :open="open" :title="title" @close="cancel">
    <slot />
    <p v-if="error" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <template #actions>
      <button
        type="button"
        :disabled="busy"
        class="rounded-xl border px-3 py-2 text-sm dark:border-gray-800"
        @click="cancel"
      >Cancel</button>
      <button
        type="button"
        :disabled="busy"
        :aria-busy="busy"
        class="rounded-xl bg-red-600 text-white px-4 py-3 text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-wait"
        @click="!busy && $emit('confirm')"
      >{{ busy ? 'Deleting…' : 'Delete' }}</button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import Modal from './Modal.vue'
const props = withDefaults(defineProps<{ open: boolean; title: string; busy?: boolean; error?: string | null }>(), { busy: false, error: null })
const emit = defineEmits<{ (e:'confirm'): void; (e:'cancel'): void }>()
function cancel() { if (!props.busy) emit('cancel') }
</script>
