<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ArrowRight, Check, ChevronDown, CircleCheck, ListTodo, LoaderCircle, Plus, RefreshCw, RotateCcw, Trash2 } from '@lucide/vue';
import type { Task, TaskPage } from '../shared/tasks';
import { api } from './api';

const tasks = ref<Task[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const title = ref('');
const filter = ref<'open' | 'done' | 'all'>('open');
const removed = ref<Task[]>([]);
const editing = ref<string | null>(null);
const draft = ref({ title: '', notes: '', status: 'todo' as Task['status'], estimate: '', actual: '', version: 1 });
let pendingCreate: { title: string; key: string } | null = null;
const visible = computed(() => tasks.value.filter(task => filter.value === 'all' || (filter.value === 'done' ? task.status === 'done' : task.status !== 'done')));
const openCount = computed(() => tasks.value.filter(task => task.status !== 'done').length);

async function load(append = false) {
  loading.value = true;
  try {
    const page = await api<TaskPage>(`/tasks${append && cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ''}`);
    tasks.value = append ? [...tasks.value, ...page.items.filter(task => !tasks.value.some(old => old.id === task.id))] : page.items;
    cursor.value = page.nextCursor;
  } finally { loading.value = false; }
}
async function run(action: () => Promise<void>) {
  if (busy.value || loading.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try { await action(); } catch (problem) { error.value = problem instanceof Error ? problem.message : 'Something went wrong. Please try again.'; }
  finally { busy.value = false; }
}
function refresh() { return run(() => load()); }
async function add() {
  const value = title.value.trim();
  if (!value) return;
  await run(async () => {
    if (pendingCreate?.title !== value) pendingCreate = { title: value, key: crypto.randomUUID() };
    await api<{ task: Task }>('/tasks', 'POST', { title: value }, pendingCreate.key);
    title.value = '';
    pendingCreate = null;
    notice.value = 'Task added.';
    await load();
  });
}
function edit(task: Task) {
  editing.value = task.id;
  draft.value = { title: task.title, notes: task.notes ?? '', status: task.status, estimate: task.estimateMinutes?.toString() ?? '', actual: task.actualMinutes?.toString() ?? '', version: task.version };
}
function replace(task: Task) { tasks.value = tasks.value.map(old => old.id === task.id ? task : old); }
function toggle(task: Task) {
  return run(async () => {
    const saved = await api<{ task: Task }>(`/tasks/${task.id}`, 'PATCH', { version: task.version, status: task.status === 'done' ? 'todo' : 'done' });
    replace(saved.task);
    notice.value = saved.task.status === 'done' ? 'Task completed. You can find it in Done.' : 'Task reopened.';
  });
}
function save(task: Task) {
  return run(async () => {
    const saved = await api<{ task: Task }>(`/tasks/${task.id}`, 'PATCH', {
      version: draft.value.version, title: draft.value.title.trim(), notes: draft.value.notes.trim() || null,
      status: draft.value.status,
      estimateMinutes: draft.value.estimate === '' ? null : Number(draft.value.estimate),
      actualMinutes: draft.value.actual === '' ? null : Number(draft.value.actual),
    });
    replace(saved.task);
    editing.value = null;
    notice.value = 'Changes saved.';
  });
}
function remove(task: Task) {
  return run(async () => {
    const saved = await api<{ task: Task }>(`/tasks/${task.id}`, 'DELETE', { version: task.version });
    removed.value = [saved.task, ...removed.value.filter(old => old.id !== task.id)];
    if (editing.value === task.id) editing.value = null;
    notice.value = 'Task deleted. You can undo it below.';
    await load();
  });
}
function restore(task: Task) {
  return run(async () => {
    await api(`/tasks/${task.id}/restore`, 'POST', { version: task.version });
    removed.value = removed.value.filter(old => old.id !== task.id);
    notice.value = 'Task restored.';
    await load();
  });
}
onMounted(async () => {
  try { await load(); } catch (problem) { error.value = problem instanceof Error ? problem.message : 'Could not load tasks.'; }
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a href="/" class="brand" aria-label="PlanWatch home"><span class="brand-icon"><Check :size="21" :stroke-width="3" /></span>PlanWatch<span class="version">2.0</span></a>
      <div class="workspace-label">YOUR SPACE</div>
      <div class="nav-current"><ListTodo :size="19" /> Tasks <span>{{ tasks.length }}{{ cursor ? '+' : '' }}</span></div>
      <div class="sidebar-note"><span class="small-dot"></span> One step at a time<p>A little less to remember.<br>A little more room to focus.</p></div>
      <div class="preview-label">Local preview <span>Foundation · step 1</span></div>
    </aside>

    <main>
      <header class="topbar"><span>Your personal workspace</span><span class="local-badge"><span class="small-dot"></span> On this computer</span></header>
      <div class="content">
        <div class="heading-row"><div><p class="eyebrow">MAKE ROOM FOR WHAT MATTERS</p><h1>Your tasks<span>.</span></h1><p class="intro">Capture a thought. Take the next step.</p></div><button class="icon-button refresh" aria-label="Refresh tasks" :disabled="busy || loading" @click="refresh"><RefreshCw :size="18" :class="{ spin: loading }" /></button></div>

        <form class="capture" @submit.prevent="add">
          <Plus :size="22" aria-hidden="true" />
          <input v-model="title" aria-label="New task title" placeholder="What would you like to do?" maxlength="200" required :disabled="busy" />
          <button class="primary" :disabled="!title.trim() || busy || loading" type="submit"><Plus :size="17" /><span>Add task</span></button>
        </form>
        <p class="capture-hint">A title is enough. Add the details when you need them.</p>

        <div v-if="error" role="alert" class="error-message">{{ error }} <button :disabled="busy || loading" @click="refresh">Refresh tasks</button></div>
        <p class="status-message" role="status" aria-live="polite">{{ notice || (busy ? 'Saving…' : '') }}</p>

        <div class="list-toolbar"><div class="filters" aria-label="Filter tasks"><button v-for="option in (['open', 'done', 'all'] as const)" :key="option" :aria-pressed="filter === option" :class="{ active: filter === option }" @click="filter = option">{{ option === 'open' ? 'Open' : option === 'done' ? 'Done' : 'All' }}<span v-if="option === 'open'">{{ openCount }}{{ cursor ? '+' : '' }}</span></button></div><span class="list-caption">{{ cursor ? 'Showing loaded tasks' : 'Your own pace' }}</span></div>

        <section class="task-list" aria-label="Tasks" :aria-busy="loading || busy">
          <div v-if="loading && !tasks.length" class="empty-state"><LoaderCircle class="spin" :size="28" /><h2>Loading your tasks…</h2></div>
          <div v-else-if="!visible.length" class="empty-state"><span class="empty-icon"><CircleCheck :size="29" /></span><h2>{{ filter === 'done' ? 'A fresh start.' : 'A little breathing room.' }}</h2><p>{{ filter === 'done' ? 'Completed tasks will appear here.' : 'Add a task above when something comes to mind.' }}</p></div>
          <article v-for="task in visible" :key="task.id" class="task" :class="{ completed: task.status === 'done', expanded: editing === task.id }">
            <div class="task-row">
              <button class="checkbox" :class="{ checked: task.status === 'done' }" :aria-label="`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`" :disabled="busy || loading || editing === task.id" @click="toggle(task)"><Check v-if="task.status === 'done'" :size="15" /></button>
              <button class="task-title" :aria-expanded="editing === task.id" :disabled="busy || loading" @click="editing === task.id ? editing = null : edit(task)"><span>{{ task.title }}</span><span class="task-meta" v-if="task.status === 'doing' || task.estimateMinutes || task.notes"><span v-if="task.status === 'doing'" class="doing-dot">In progress</span><span v-if="task.estimateMinutes">{{ task.estimateMinutes }} min estimated</span><span v-if="task.notes">Has notes</span></span></button>
              <button class="icon-button" :aria-label="`Edit ${task.title}`" :aria-expanded="editing === task.id" :disabled="busy || loading" @click="editing === task.id ? editing = null : edit(task)"><ChevronDown :size="18" :class="{ flipped: editing === task.id }" /></button>
            </div>
            <form v-if="editing === task.id" class="task-details" @submit.prevent="save(task)">
              <fieldset :disabled="busy || loading"><label>Title<input v-model="draft.title" required maxlength="200" /></label><label>Notes <span>optional</span><textarea v-model="draft.notes" maxlength="5000" rows="3" placeholder="Anything you want to remember…"></textarea></label><div class="detail-grid"><label>Status<select v-model="draft.status"><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select></label><label>Estimate <span>minutes</span><input v-model="draft.estimate" type="number" min="1" step="1" placeholder="—" /></label><label>Time spent <span>minutes</span><input v-model="draft.actual" type="number" min="0" step="1" placeholder="—" /></label></div><div class="detail-actions"><button type="button" class="delete-button" @click="remove(task)"><Trash2 :size="16" />Delete</button><div><button type="button" class="secondary" @click="editing = null">Cancel</button><button class="primary" type="submit">Save changes<ArrowRight :size="16" /></button></div></div></fieldset>
            </form>
          </article>
        </section>
        <button v-if="cursor" class="load-more secondary" :disabled="busy || loading" @click="run(() => load(true))">{{ loading ? 'Loading…' : 'Load more tasks' }}</button>

        <section v-if="removed.length" class="recovery" aria-label="Recently deleted this session"><h2>Deleted this session</h2><div v-for="task in removed" :key="task.id"><span>{{ task.title }}</span><button :disabled="busy || loading" @click="restore(task)"><RotateCcw :size="15" />Undo delete</button></div><p>Undo is available here until you leave this page. Deleted records remain in the local database.</p></section>
        <footer><span class="small-dot"></span>Saved on this computer. Phone access comes in a later step.</footer>
      </div>
    </main>
  </div>
</template>
