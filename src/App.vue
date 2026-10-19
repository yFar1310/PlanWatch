<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { CalendarDays, Check, ChevronDown, CircleCheck, ListTodo, LoaderCircle, Moon, Plus, RefreshCw, RotateCcw, Search, Sun, Trash2, X } from '@lucide/vue';
import type { Task, TaskPage } from '../shared/tasks';
import { currentDay, formatDay, nextDay, TIME_ZONE } from '../shared/calendar';
import { api, ApiError } from './api';
import { capture, clearDraft, drafts, storageAvailable, type TaskDraft } from './drafts';
import { useTheme } from './theme';
import TaskEditor from './TaskEditor.vue';

type View = 'today' | 'tasks' | 'trash';
const view = ref<View>('today');
const status = ref<'open' | 'done' | 'all'>('open');
const search = ref('');
const tasks = ref<Task[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const editing = ref<string | null>(null);
const lastDeleted = ref<Task | null>(null);
const today = ref(currentDay());
const { isDark, toggle: toggleTheme } = useTheme();
const titleInput = ref<HTMLInputElement | null>(null);
const listRegion = ref<HTMLElement | null>(null);
const heading = computed(() => view.value === 'today' ? 'A little focus for today.' : view.value === 'trash' ? 'Room to reconsider.' : 'Everything in one place.');
const description = computed(() => view.value === 'today' ? `${formatDay(today.value)} · Today and overdue · ${TIME_ZONE}` : view.value === 'trash' ? 'Deleted tasks stay here. Restore them whenever you need.' : 'Your plans, in progress and at your own pace.');
let sequence = 0;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let disposed = false;

async function load(append = false) {
  const request = ++sequence;
  loading.value = true;
  const query = new URLSearchParams({ view: view.value, status: view.value === 'tasks' ? status.value : 'all', q: search.value.trim() });
  if (view.value === 'today') query.set('day', today.value);
  if (append && cursor.value) query.set('cursor', cursor.value);
  try {
    const page = await api<TaskPage>(`/tasks?${query}`);
    if (request !== sequence || disposed) return;
    tasks.value = append ? [...tasks.value, ...page.items.filter(task => !tasks.value.some(old => old.id === task.id))] : page.items;
    cursor.value = page.nextCursor;
  } catch (problem) {
    if (request === sequence && !disposed) throw problem;
  } finally { if (request === sequence && !disposed) loading.value = false; }
}
function showError(problem: unknown) { error.value = problem instanceof Error ? problem.message : 'Something went wrong. Please try again.'; }
async function reload() {
  clearTimeout(reloadTimer);
  error.value = '';
  try { await load(); } catch (problem) { showError(problem); }
}
watch([view, status, search, today], (values, old) => {
  ++sequence;
  clearTimeout(reloadTimer);
  loading.value = true;
  tasks.value = [];
  cursor.value = null;
  editing.value = null;
  const delay = values[2] !== old[2] ? 300 : 0;
  reloadTimer = setTimeout(() => { void reload(); }, delay);
});
async function run(action: () => Promise<void>) {
  if (busy.value || loading.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try { await action(); }
  catch (problem) {
    showError(problem);
    if (problem instanceof ApiError && problem.status === 409) {
      // Reload the saved version, while the editor keeps its original draft/version.
      try { await load(); } catch { /* Keep the original conflict message and draft. */ }
    }
  } finally { busy.value = false; }
}
function chooseView(value: View) { if (!busy.value) { view.value = value; search.value = ''; } }
async function focusList() {
  await nextTick();
  const target = listRegion.value?.querySelector<HTMLButtonElement>('button.task-title:not(:disabled), button.restore-button:not(:disabled)');
  (target ?? listRegion.value)?.focus();
}
async function add() {
  const title = capture.value.title.trim();
  if (!title) return;
  await run(async () => {
    const plannedDate = capture.value.plannedDate || null;
    const payload = JSON.stringify({ title, plannedDate });
    if (capture.value.payload !== payload || !capture.value.key) {
      capture.value = { ...capture.value, key: crypto.randomUUID(), payload };
    }
    await api<{ task: Task }>('/tasks', 'POST', { title, plannedDate }, capture.value.key!);
    capture.value = { title: '', plannedDate: capture.value.plannedDate, key: null, payload: null };
    notice.value = plannedDate ? `Added for ${formatDay(plannedDate)}. Find all your tasks in Tasks.` : 'Added without a date. Find it in Tasks.';
    await load();
  });
  await nextTick();
  if (!error.value) titleInput.value?.focus();
}
function toggle(task: Task) {
  return run(async () => {
    const done = task.status !== 'done';
    await api(`/tasks/${task.id}`, 'PATCH', { version: task.version, status: done ? 'done' : 'todo' });
    notice.value = done ? 'Task completed. Find it in Tasks → Done.' : 'Task reopened.';
    await load();
  }).then(() => { if (!error.value) return focusList(); });
}
function save(task: Task, draft: TaskDraft) {
  return run(async () => {
    await api(`/tasks/${task.id}`, 'PATCH', {
      version: draft.version, title: draft.title.trim(), notes: draft.notes.trim() || null,
      status: draft.status, plannedDate: draft.plannedDate || null,
      estimateMinutes: draft.estimate === '' ? null : Number(draft.estimate),
      actualMinutes: draft.actual === '' ? null : Number(draft.actual),
    });
    clearDraft(task.id);
    editing.value = null;
    notice.value = 'Changes saved.';
    await load();
  }).then(() => { if (!error.value) return focusList(); });
}
function remove(task: Task) {
  return run(async () => {
    const saved = await api<{ task: Task }>(`/tasks/${task.id}`, 'DELETE', { version: task.version });
    lastDeleted.value = saved.task;
    clearDraft(task.id);
    editing.value = null;
    notice.value = 'Moved to Trash. You can undo this or restore it from Trash later.';
    await load();
  }).then(() => { if (!error.value) return focusList(); });
}
function restore(task: Task) {
  return run(async () => {
    await api(`/tasks/${task.id}/restore`, 'POST', { version: task.version });
    if (lastDeleted.value?.id === task.id) lastDeleted.value = null;
    notice.value = 'Task restored with its saved details and planned day.';
    await load();
  }).then(() => { if (!error.value) return focusList(); });
}
function tick() {
  const day = currentDay();
  if (day !== today.value) {
    if (!capture.value.title && capture.value.plannedDate === today.value) capture.value.plannedDate = day;
    today.value = day;
  }
}
onMounted(() => {
  void reload();
  clockTimer = setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', tick);
});
onUnmounted(() => {
  disposed = true;
  ++sequence;
  clearTimeout(reloadTimer);
  clearInterval(clockTimer);
  document.removeEventListener('visibilitychange', tick);
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a href="/" class="brand" aria-label="PlanWatch home"><span class="brand-icon"><Check :size="21" :stroke-width="3" /></span>PlanWatch<span class="version">2.0</span></a>
      <div class="workspace-label">YOUR SPACE</div>
      <nav class="workspace-nav" aria-label="Workspace">
        <button v-for="item in ([{ id: 'today', title: 'Today', icon: CalendarDays }, { id: 'tasks', title: 'Tasks', icon: ListTodo }, { id: 'trash', title: 'Trash', icon: Trash2 }] as const)" :key="item.id" :class="{ active: view === item.id }" :aria-current="view === item.id ? 'page' : undefined" :disabled="busy" @click="chooseView(item.id)"><component :is="item.icon" :size="19" />{{ item.title }}</button>
      </nav>
      <div class="sidebar-note"><span class="small-dot"></span> One step at a time<p>A little less to remember.<br>A little more room to focus.</p></div>
      <div class="preview-label">Local preview <span>Daily planning · step 2</span></div>
    </aside>

    <main>
      <header class="topbar">
        <span class="workspace-heading">Your personal workspace</span>
        <div class="topbar-actions">
          <span class="local-badge"><span class="small-dot"></span> On this computer</span>
          <button class="theme-toggle" type="button" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleTheme">
            <component :is="isDark ? Sun : Moon" :key="isDark ? 'sun' : 'moon'" :size="20" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div class="content">
        <div class="heading-row">
          <div><p class="eyebrow">{{ view === 'today' ? 'MAKE ROOM FOR WHAT MATTERS' : view === 'trash' ? 'NOTHING LOST IN A CLICK' : 'YOUR PLANS, YOUR PACE' }}</p><h1>{{ heading }}</h1><p class="intro">{{ description }}</p></div>
          <button class="icon-button refresh" aria-label="Refresh tasks" :disabled="busy || loading" @click="reload"><RefreshCw :size="18" :class="{ spin: loading }" /></button>
        </div>

        <template v-if="view !== 'trash'">
          <form class="capture" @submit.prevent="add">
            <div class="capture-main"><Plus :size="22" aria-hidden="true" /><input ref="titleInput" v-model="capture.title" aria-label="New task title" placeholder="What would you like to do?" maxlength="200" required :disabled="busy" /><button class="primary" :disabled="!capture.title.trim() || busy || loading" type="submit"><Plus :size="17" /><span>Add task</span></button></div>
            <fieldset class="capture-schedule" :disabled="busy"><label class="capture-date"><CalendarDays :size="15" /><span class="sr-only">Planned day for new task, optional</span><input v-model="capture.plannedDate" type="date" min="0001-01-01" max="9999-12-31" /></label><button class="date-chip" type="button" @click="capture.plannedDate = today">Today</button><button class="date-chip" type="button" @click="capture.plannedDate = nextDay(today)">Tomorrow</button><button class="date-chip" type="button" @click="capture.plannedDate = ''">No date</button></fieldset>
          </form>
          <p class="capture-hint">A title is enough. Dates and details are optional.{{ !storageAvailable ? ' Drafts will last only while this page stays open.' : '' }}</p>
        </template>

        <div v-if="error" role="alert" class="error-message">{{ error }} <button :disabled="busy || loading" @click="reload">Refresh tasks</button></div>
        <div class="status-message" role="status" aria-live="polite"><span>{{ notice || (busy ? 'Saving…' : '') }}</span><button v-if="lastDeleted" class="undo-button" :disabled="busy || loading" @click="restore(lastDeleted)"><RotateCcw :size="15" />Undo last delete</button></div>

        <div class="list-toolbar">
          <div v-if="view === 'tasks'" class="filters" aria-label="Filter tasks"><button v-for="option in (['open', 'done', 'all'] as const)" :key="option" :aria-pressed="status === option" :class="{ active: status === option }" :disabled="busy" @click="status = option">{{ option === 'open' ? 'Open' : option === 'done' ? 'Done' : 'All' }}</button></div>
          <h2 v-else class="section-label">{{ view === 'today' ? 'Your next steps' : 'Deleted tasks' }}</h2>
          <label class="search-control"><Search :size="16" /><span class="sr-only">Search {{ view === 'trash' ? 'Trash' : view === 'today' ? 'Today' : 'tasks' }}</span><input v-model="search" type="search" maxlength="200" :placeholder="view === 'trash' ? 'Search Trash…' : 'Search tasks…'" :disabled="busy" /><button v-if="search" type="button" class="icon-button" aria-label="Clear search" :disabled="busy" @click="search = ''"><X :size="16" /></button></label>
        </div>

        <section ref="listRegion" class="task-list" tabindex="-1" aria-label="Tasks" :aria-busy="loading || busy">
          <div v-if="loading && !tasks.length" class="empty-state"><LoaderCircle class="spin" :size="28" /><h2>Loading your tasks…</h2></div>
          <div v-else-if="!tasks.length" class="empty-state"><span class="empty-icon"><component :is="view === 'trash' ? Trash2 : CircleCheck" :size="29" /></span><h2>{{ error ? 'Your tasks could not be loaded.' : search.trim() ? 'No matching tasks.' : view === 'trash' ? 'Your Trash is empty.' : view === 'today' ? 'A little breathing room.' : status === 'done' ? 'A fresh start.' : 'A place for your next step.' }}</h2><p>{{ error ? 'Try refreshing. Your saved tasks have not been removed.' : search.trim() ? 'Try another word or clear the search.' : view === 'trash' ? 'Deleted tasks will stay here until you restore them.' : view === 'today' ? 'Nothing open is planned for today or earlier. Add something above, or look in Tasks.' : status === 'done' ? 'Completed tasks will appear here.' : 'Capture a task above when something comes to mind.' }}</p><button v-if="view === 'today' && !search && !error" class="secondary" :disabled="busy" @click="chooseView('tasks')">Browse all tasks</button></div>
          <article v-for="task in tasks" :key="task.id" class="task" :class="{ completed: task.status === 'done', expanded: editing === task.id }">
            <div class="task-row">
              <span v-if="view === 'trash'" class="trash-marker"><Trash2 :size="18" /></span>
              <button v-else class="checkbox" :class="{ checked: task.status === 'done' }" :aria-label="`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`" :disabled="busy || loading || editing === task.id || !!drafts[task.id]" @click="toggle(task)"><Check v-if="task.status === 'done'" :size="15" /></button>
              <component :is="view === 'trash' ? 'div' : 'button'" class="task-title" :aria-expanded="view === 'trash' ? undefined : editing === task.id" :disabled="view === 'trash' ? undefined : busy || loading" @click="view !== 'trash' && (editing = editing === task.id ? null : task.id)">
                <span>{{ task.title }}</span>
                <span class="task-meta"><span v-if="task.plannedDate" :class="{ overdue: task.status !== 'done' && task.plannedDate < today }">{{ task.status !== 'done' && task.plannedDate < today ? 'Overdue · ' : '' }}{{ task.plannedDate === today ? 'Today' : task.plannedDate === nextDay(today) ? 'Tomorrow' : formatDay(task.plannedDate) }}</span><span v-else>No date</span><span v-if="task.status === 'doing'" class="doing-dot">In progress</span><span v-if="task.estimateMinutes">{{ task.estimateMinutes }} min estimated</span><span v-if="drafts[task.id]">Unsaved draft</span><span v-else-if="task.notes">Has notes</span></span>
              </component>
              <button v-if="view === 'trash'" class="restore-button secondary" :aria-label="`Restore ${task.title}`" :disabled="busy || loading" @click="restore(task)"><RotateCcw :size="16" />Restore</button>
              <button v-else class="icon-button" :aria-label="`${editing === task.id ? 'Close details for' : 'Edit'} ${task.title}`" :aria-expanded="editing === task.id" :disabled="busy || loading" @click="editing = editing === task.id ? null : task.id"><ChevronDown :size="18" :class="{ flipped: editing === task.id }" /></button>
            </div>
            <TaskEditor v-if="editing === task.id && view !== 'trash'" :task="task" :disabled="busy || loading" :today="today" @save="save(task, $event)" @delete="remove(task)" @close="editing = null" />
          </article>
        </section>
        <div class="list-bottom"><span v-if="tasks.length">{{ tasks.length }} {{ tasks.length === 1 ? 'task' : 'tasks' }}{{ cursor ? ' loaded · more available' : '' }}</span><button v-if="cursor" class="secondary" :disabled="busy || loading" @click="run(() => load(true))">{{ loading ? 'Loading…' : 'Load more' }}</button></div>
        <footer><span class="small-dot"></span>Saved on this computer. Phone access comes in a later step.</footer>
      </div>
    </main>
  </div>
</template>
