<template>
<div>
<Label v-if="label">{{ label }}</Label>
<div class="mt-1">
<slot />
</div>
<p v-if="hint" class="mt-1 text-xs text-gray-500">{{ hint }}</p>
<p v-if="error" class="mt-1 text-xs text-red-600">{{ error }}</p>
</div>
</template>
<script setup lang="ts">
import Label from './Label.vue'


defineProps<{ label?: string; hint?: string; error?: string }>()
</script>