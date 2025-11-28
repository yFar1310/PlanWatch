<template>
  <Transition
    enter-active-class="transition ease-out duration-200"
    enter-from-class="opacity-0 -translate-y-1"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition ease-in duration-150"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-1"
  >
    <div
      v-if="visible"
      :class="[
        'rounded-xl p-4 ring-1 flex items-start gap-3',
        variantClasses.base,
        variantClasses.ring,
        dense ? 'py-2 px-3' : ''
      ]"
      :role="role"
      :aria-live="ariaLive"
    >
      <component
        v-if="Icon"
        :is="Icon"
        class="h-5 w-5 shrink-0"
        :class="variantClasses.icon"
        aria-hidden="true"
      />

      <div class="flex-1 min-w-0">
        <h3
          v-if="message || $slots.title"
          class="text-sm font-semibold leading-6"
          :class="variantClasses.title"
        >
          {{ message }}
          <slot name="title" />
        </h3>

        <p
          v-if="$slots.default"
          class="mt-1 text-sm leading-6"
          :class="variantClasses.text"
        >
          <slot />
        </p>

        <slot name="message" />
      </div>

      <div class="flex items-center gap-2">
        <slot name="actions" />
        <button
          v-if="dismissible"
          type="button"
          class="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-black/5 dark:hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-brand/40"
          @click="$emit('close')"
          :aria-label="closeLabel"
        >
          <svg
            viewBox="0 0 20 20"
            class="h-4 w-4"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M10 8.586l4.95-4.95 1.414 1.414L11.414 10l4.95 4.95-1.414 1.414L10 11.414l-4.95 4.95-1.414-1.414L8.586 10 3.636 5.05l1.414-1.414L10 8.586z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  XCircleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/vue/20/solid'

type AlertType = 'danger' | 'success' | 'info' | 'warning' | 'error'

const props = withDefaults(
  defineProps<{
    type?: AlertType
    message?: string
    icon?: Component | null
    dismissible?: boolean
    dense?: boolean
    show?: boolean
    role?: 'alert' | 'status'
    ariaLive?: 'polite' | 'assertive' | 'off'
    closeLabel?: string
  }>(),
  {
    type: 'danger',
    icon: null,
    dismissible: false,
    dense: false,
    show: true,
    role: 'status',
    ariaLive: 'polite',
    closeLabel: 'Close',
  },
)

defineEmits<{
  (e: 'close'): void
}>()

const map = {
  danger: {
    base: 'bg-red-50 dark:bg-red-950/40',
    ring: 'ring-red-200/60 dark:ring-red-900/50',
    title: 'text-red-900 dark:text-red-200',
    text: 'text-red-800/80 dark:text-red-300/80',
    icon: 'text-red-600 dark:text-red-300',
  },
  success: {
    base: 'bg-emerald-50 dark:bg-emerald-950/40',
    ring: 'ring-emerald-200/60 dark:ring-emerald-900/50',
    title: 'text-emerald-900 dark:text-emerald-200',
    text: 'text-emerald-800/80 dark:text-emerald-300/80',
    icon: 'text-emerald-600 dark:text-emerald-300',
  },
  info: {
    base: 'bg-sky-50 dark:bg-sky-950/40',
    ring: 'ring-sky-200/60 dark:ring-sky-900/50',
    title: 'text-sky-900 dark:text-sky-200',
    text: 'text-sky-800/80 dark:text-sky-300/80',
    icon: 'text-sky-600 dark:text-sky-300',
  },
  warning: {
    base: 'bg-amber-50 dark:bg-amber-950/40',
    ring: 'ring-amber-200/60 dark:ring-amber-900/50',
    title: 'text-amber-900 dark:text-amber-200',
    text: 'text-amber-800/80 dark:text-amber-300/80',
    icon: 'text-amber-600 dark:text-amber-300',
  },
  // alias error -> danger
  error: {
    base: 'bg-red-50 dark:bg-red-950/40',
    ring: 'ring-red-200/60 dark:ring-red-900/50',
    title: 'text-red-900 dark:text-red-200',
    text: 'text-red-800/80 dark:text-red-300/80',
    icon: 'text-red-600 dark:text-red-300',
  },
} as const

const defaultIcons: Record<AlertType, Component> = {
  danger: XCircleIcon,
  error: XCircleIcon,
  success: CheckCircleIcon,
  info: InformationCircleIcon,
  warning: ExclamationTriangleIcon,
}

const Icon = computed<Component | null>(() => props.icon ?? defaultIcons[props.type])
const variantClasses = computed(() => map[props.type] || map.danger)
const visible = computed(() => props.show)
</script>
