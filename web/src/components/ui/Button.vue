<template>
<button
:type="type"
class="inline-flex items-center justify-center gap-2 rounded-xl bg-brand text-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
>
<slot />
</button>
</template>
<script setup lang="ts">
withDefaults(defineProps<{ type?: 'button'|'submit'|'reset' }>(), { type: 'button' })
</script>