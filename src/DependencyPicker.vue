<script setup lang="ts">
import { onUnmounted, ref, watch, useId } from 'vue';
import type { Task, TaskPage } from '../shared/tasks';
import { api } from './api';
const props = defineProps<{ modelValue: string | null; excludeId?: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [id: string | null]; failure: [problem: unknown] }>();
const id = useId();
const open = ref(false), search = ref(''), title = ref(''), error = ref(''), loading = ref(false);
const items = ref<Task[]>([]), cursor = ref<string | null>(null);
let sequence = 0, selectedSequence = 0, disposed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => props.modelValue, async value => {
  const request = ++selectedSequence;
  title.value = ''; error.value = '';
  if (!value) return;
  try { const result = await api<{task:Task}>(`/tasks/${value}`); if (!disposed && request === selectedSequence) title.value = result.task.title; }
  catch (problem) { if (!disposed && request === selectedSequence) { title.value = 'Unavailable task'; emit('failure',problem); } }
}, { immediate:true });
async function load(append = false) {
  const request = ++sequence;
  loading.value = true; error.value = '';
  const query = new URLSearchParams({ view:'tasks', status:'all', q:search.value.trim(), limit:'20' });
  if (append && cursor.value) query.set('cursor',cursor.value);
  try {
    const page = await api<TaskPage>(`/tasks?${query}`);
    if (disposed || request !== sequence) return;
    items.value = [...(append ? items.value : []),...page.items.filter(task => task.id !== props.excludeId)]; cursor.value = page.nextCursor;
  } catch (problem) { if (!disposed && request === sequence) { error.value = problem instanceof Error ? problem.message : 'Could not load tasks.'; emit('failure',problem); } }
  finally { if (!disposed && request === sequence) loading.value = false; }
}
function expand() { open.value = !open.value; if(open.value) void load(); }
function choose(task: Task) { emit('update:modelValue',task.id); title.value = task.title; open.value = false; }
watch(search, () => { ++sequence; clearTimeout(timer); timer = setTimeout(() => { if(open.value) void load(); },250); });
onUnmounted(() => { disposed = true; ++sequence; ++selectedSequence; clearTimeout(timer); });
</script>
<template>
  <div class="dependency-picker">
    <span class="field-label">Prerequisite <span class="optional-label">optional</span></span>
    <div class="dependency-summary"><span>{{ modelValue ? (title || 'Loading prerequisite…') : 'Independent task' }}</span><button type="button" class="secondary" :disabled="disabled" :aria-expanded="open" :aria-controls="id" @click="expand">{{ modelValue ? 'Change prerequisite' : 'Choose prerequisite' }}</button><button v-if="modelValue" type="button" class="secondary" :disabled="disabled" @click="emit('update:modelValue',null)">Remove prerequisite</button></div>
    <div v-if="open" :id="id" class="dependency-options">
      <label>Search your tasks<input v-model="search" type="search" maxlength="200" placeholder="Task title or notes" :disabled="disabled" /></label>
      <p class="capture-hint">Finish this prerequisite before completing the new task. Loops between tasks are rejected.</p>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="loading" role="status">Searching…</p>
      <ul><li v-for="task in items" :key="task.id"><button type="button" :disabled="disabled || loading" @click="choose(task)"><span>{{ task.title }}</span><span>{{ task.status === 'done' ? 'Done' : 'Not completed' }}</span></button></li></ul>
      <p v-if="!items.length && !loading && !error">No matching tasks.</p>
      <button v-if="cursor" class="secondary" type="button" :disabled="loading || disabled" @click="load(true)">More tasks</button>
    </div>
  </div>
</template>
