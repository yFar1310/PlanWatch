<template>
  <Modal :open="open" :title="title" @close="$emit('cancel')">
    <slot />
    <template #actions>
      <button
        class="rounded-xl border px-3 py-2 text-sm dark:border-gray-800"
        @click="$emit('cancel')"
      >Cancel</button>
      <button
        class="rounded-xl bg-red-600 text-white px-3 py-2 text-sm hover:bg-red-700"
        @click="$emit('confirm')"
      >Delete</button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import Modal from './Modal.vue'
defineProps<{ open: boolean; title: string }>()
defineEmits<{ (e:'confirm'): void; (e:'cancel'): void }>()
</script>
