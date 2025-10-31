<template>
  <TransitionRoot :show="open" as="template">
    <Dialog :open="open" @close="$emit('close')" class="relative z-50">
      <!-- overlay -->
      <TransitionChild
        as="template"
        enter="ease-out duration-200"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-150"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      </TransitionChild>

      <!-- panel -->
      <div class="fixed inset-0 flex items-center justify-center p-4">
        <TransitionChild
          as="template"
          enter="ease-out duration-200"
          enter-from="opacity-0 translate-y-2 scale-95"
          enter-to="opacity-100 translate-y-0 scale-100"
          leave="ease-in duration-150"
          leave-from="opacity-100 translate-y-0 scale-100"
          leave-to="opacity-0 translate-y-2 scale-95"
        >
          <DialogPanel
            class="w-full max-w-md rounded-2xl bg-white dark:bg-gray-950 p-6 shadow-xl ring-1 ring-black/10 dark:ring-white/10"
          >
            <div class="flex items-start gap-3">
              <slot name="icon" />
              <div class="flex-1 min-w-0">
                <DialogTitle class="text-base font-semibold">{{ title }}</DialogTitle>
                <div class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  <slot />
                </div>
              </div>
            </div>

            <div class="mt-6 flex justify-end gap-2">
              <slot name="actions">
                <button
                  type="button"
                  class="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  @click="$emit('close')"
                >
                  OK
                </button>
              </slot>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle, TransitionChild, TransitionRoot } from '@headlessui/vue'
defineProps<{ open: boolean; title: string }>()
defineEmits<{ (e:'close'): void }>()
</script>
