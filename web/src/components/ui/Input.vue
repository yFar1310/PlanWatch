<template>
  <input
    v-bind="safeAttrs"
    :type="type"
    :value="stringValue"
    class="w-full rounded-xl border border-gray-700/40 bg-transparent px-4 py-3 outline-none focus:ring-2 focus:ring-brand/40"
    @input="onInput"
  />
</template>

<script setup lang="ts">
import { computed, useAttrs } from 'vue';

const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  type?: string
}>(), { type: 'text' });

const emit = defineEmits<{ (e:'update:modelValue', v:string|number|null):void }>();

const attrs = useAttrs();

/** n'autorise que des noms d'attributs valides (HTML, aria-, data-) */
const safeAttrs = computed(() => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (/^(aria-[\w-]+|data-[\w-]+|[a-zA-Z_][\w\-:.]*)$/.test(k)) out[k] = v;
  }
  return out;
});

const stringValue = computed(() =>
  props.modelValue == null ? '' : String(props.modelValue)
);

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  if (props.type === 'number') emit('update:modelValue', raw === '' ? null : Number(raw));
  else emit('update:modelValue', raw);
}
</script>
