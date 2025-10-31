<template>
  <textarea
    v-bind="safeAttrs"
    :value="modelValue ?? ''"
    class="w-full rounded-xl border border-gray-700/40 bg-transparent px-4 py-3 outline-none focus:ring-2 focus:ring-brand/40"
    @input="e => emit('update:modelValue', (e.target as HTMLTextAreaElement).value)"
  />
</template>

<script setup lang="ts">
import { useAttrs, computed } from 'vue';
defineProps<{ modelValue?: string | null }>();
const emit = defineEmits<{ (e:'update:modelValue', v:string): void }>();
const attrs = useAttrs();
const safeAttrs = computed(() => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (/^(aria-[\w-]+|data-[\w-]+|[a-zA-Z_][\w\-:.]*)$/.test(k)) out[k] = v;
  }
  return out;
});
</script>
