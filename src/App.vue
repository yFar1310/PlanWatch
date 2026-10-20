<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { CalendarDays, Check, ChevronDown, CircleCheck, Download, ListTodo, LoaderCircle, LogOut, Moon, Plus, RefreshCw, RotateCcw, Search, Shield, Sun, Trash2, WifiOff, X } from '@lucide/vue';
import { priorities, type TaskPriority, type Task, type TaskPage } from '../shared/tasks';
import type { SessionInfo } from '../shared/session';
import { currentDay, formatDay, nextDay, TIME_ZONE } from '../shared/calendar';
import { api, ApiError } from './api';
import { activateDrafts, deactivateDrafts, capture, clearDraft, drafts, storageAvailable, type TaskDraft } from './drafts';
import { useTheme } from './theme';
import ConfirmDialog from './ConfirmDialog.vue';
import DependencyPicker from './DependencyPicker.vue';
import AdminPanel from './AdminPanel.vue';
import { pendingInvitation, invitationCode, clearInvitation } from './invitations';
import TaskEditor from './TaskEditor.vue';
import { usePwa } from './pwa';

defineProps<{ accountId?: string }>();
const emit = defineEmits<{ signOut: []; signIn: [] }>();
type View = 'today' | 'tasks' | 'trash' | 'admin';
const view = ref<View>('today');
const status = ref<'open' | 'done' | 'all'>('open');
const search = ref('');
const priorityFilter = ref<TaskPriority | 'all'>('all');
const completion = ref<{ task: Task; draft?: TaskDraft } | null>(null);
const tasks = ref<Task[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const editing = ref<string | null>(null);
const lastDeleted = ref<Task | null>(null);
const online = ref(navigator.onLine);
const session = ref<SessionInfo | null>(null);
const authState = ref<'loading' | 'ready' | 'signin' | 'unavailable' | 'invite' | 'banned'>('loading');
const inviteInput = ref(pendingInvitation.value);
const displayName = ref('');
const usageAcknowledged = ref(false);
const joining = ref(false);
const setupRequired = ref(false);
const lastSynced = ref<number | null>(null);
const canWrite = computed(() => online.value && authState.value === 'ready');
const { canInstall, help: installHelp, install, update: appUpdate, applyUpdate, registrationError } = usePwa();
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
let checkingSession = false;

async function load(append = false) {
  if (disposed || authState.value !== 'ready' || view.value === 'admin') return;
  const request = ++sequence;
  loading.value = true;
  if (!online.value) { loading.value = false; throw new Error('Reconnect to refresh your tasks.'); }
  const query = new URLSearchParams({ view: view.value, status: view.value === 'tasks' ? status.value : 'all', q: search.value.trim(), priority: priorityFilter.value });
  if (view.value === 'today') query.set('day', today.value);
  if (append && cursor.value) query.set('cursor', cursor.value);
  try {
    const page = await api<TaskPage>(`/tasks?${query}`);
    if (request !== sequence || disposed || authState.value !== 'ready') return;
    tasks.value = append ? [...tasks.value, ...page.items.filter(task => !tasks.value.some(old => old.id === task.id))] : page.items;
    cursor.value = page.nextCursor;
    lastSynced.value = Date.now();
  } catch (problem) {
    if (request === sequence && !disposed) throw problem;
  } finally { if (request === sequence && !disposed) loading.value = false; }
}
function clearPrivateView() { completion.value = null; ++sequence; loading.value = false; tasks.value = []; cursor.value = null; editing.value = null; lastDeleted.value = null; lastSynced.value = null; }
function showError(problem: unknown) {
  if (disposed) return;
  error.value = problem instanceof Error ? problem.message : 'Something went wrong. Please try again.';
  setupRequired.value = problem instanceof ApiError && problem.code === 'setup_required';
  if (problem instanceof ApiError && [401, 403].includes(problem.status)) {
    authState.value = problem.code === 'invitation_required' ? 'invite' : problem.code === 'account_banned' ? 'banned' : 'signin';
    deactivateDrafts();
    session.value = null;
    clearPrivateView();
  }
}
async function checkSession() {
  if (!online.value || checkingSession || disposed) return false;
  checkingSession = true;
  try {
    const verified = await api<SessionInfo>('/session');
    if (disposed) return false;
    if (!verified.workspaceId) throw new Error('Workspace verification failed. Reload to try again.');
    activateDrafts(verified.workspaceId, verified.canAdmin || verified.mode === 'local');
    session.value = verified;
    clearInvitation();
    if (view.value === 'admin' && !verified.canAdmin) view.value = 'today';
    setupRequired.value = false;
    authState.value = 'ready';
    void activity();
    return true;
  } catch (problem) {
    if (disposed) return false;
    authState.value = 'unavailable';
    session.value = null;
    deactivateDrafts();
    clearPrivateView();
    showError(problem);
    return false;
  } finally { checkingSession = false; }
}
async function join() {
  if (joining.value || !usageAcknowledged.value) return;
  const code = invitationCode(inviteInput.value);
  if (!code) { error.value = 'Paste a complete invitation link or a valid invitation code.'; return; }
  joining.value = true; error.value = '';
  try {
    await api('/invitations/accept', 'POST', { code, displayName: displayName.value.trim(), usageAcknowledged: true });
    if (disposed) return;
    clearInvitation(); inviteInput.value = '';
    if (await checkSession()) await load();
  } catch (problem) {
    if (problem instanceof ApiError && problem.code === 'already_member') { if (await checkSession()) await load(); }
    else showError(problem);
  } finally { joining.value = false; }
}
let lastInteraction = Date.now();
let sendingActivity = false;
function interacted() { lastInteraction = Date.now(); }
async function activity() {
  if (sendingActivity || disposed || !online.value || authState.value !== 'ready' || session.value?.mode !== 'clerk') return;
  sendingActivity = true;
  try { await api('/activity', 'POST', { active: document.visibilityState === 'visible' && Date.now() - lastInteraction < 60_000 }); }
  catch (problem) { if (problem instanceof ApiError && [401, 403].includes(problem.status)) showError(problem); }
  finally { sendingActivity = false; }
}
function visibilityChanged() { tick(); void activity(); }

async function reload() {
  clearTimeout(reloadTimer);
  error.value = '';
  if (!online.value) { loading.value = false; return; }
  if (authState.value !== 'ready' && !await checkSession()) { loading.value = false; return; }
  try { await load(); } catch (problem) { showError(problem); }
}
watch([view, status, search, today, priorityFilter], (values, old) => {
  ++sequence;
  clearTimeout(reloadTimer);
  loading.value = true;
  tasks.value = [];
  cursor.value = null;
  editing.value = null;
  const delay = values[2] !== old[2] ? 300 : 0;
  reloadTimer = setTimeout(() => { void reload(); }, delay);
});
async function run(action: () => Promise<void>, allowWhileLoading = false) {
  if (busy.value || (loading.value && !allowWhileLoading)) return;
  if (!canWrite.value) { error.value = online.value ? 'Sign in before saving your changes.' : 'Reconnect to save. Your changes remain as drafts.'; return; }
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
    const payload = JSON.stringify({ title, plannedDate, priority: capture.value.priority, dependsOn: capture.value.dependsOn });
    let previousPayload = capture.value.payload;
    try {
      const previous = JSON.parse(previousPayload ?? 'null');
      if (previous && typeof previous === 'object') previousPayload = JSON.stringify({ title: previous.title, plannedDate: previous.plannedDate ?? null, priority: previous.priority ?? 'medium', dependsOn: previous.dependsOn ?? null });
    } catch { /* An unreadable draft receives a new request key. */ }
    if (previousPayload !== payload || !capture.value.key) {
      capture.value = { ...capture.value, key: crypto.randomUUID(), payload };
    }
    capture.value.payload = payload;
    await api<{ task: Task }>('/tasks', 'POST', { title, plannedDate, priority: capture.value.priority, dependsOn: capture.value.dependsOn }, capture.value.key!);
    capture.value = { title: '', plannedDate: capture.value.plannedDate, key: null, payload: null, priority: 'medium', dependsOn: null };
    notice.value = plannedDate ? `Added for ${formatDay(plannedDate)}. Find all your tasks in Tasks.` : 'Added without a date. Find it in Tasks.';
    await load();
  }, true);
  await nextTick();
  if (!error.value) titleInput.value?.focus();
}
function requestToggle(task: Task) {
  if (task.status === 'done') return toggle(task);
  completion.value = { task };
}
async function confirmCompletion() {
  const pending = completion.value;
  if (!pending) return;
  if (pending.draft) await save(pending.task, pending.draft, true);
  else await toggle(pending.task);
  completion.value = null;
}
function toggle(task: Task) {
  return run(async () => {
    const done = task.status !== 'done';
    await api(`/tasks/${task.id}`, 'PATCH', { version: task.version, status: done ? 'done' : 'todo' });
    notice.value = done ? 'Task completed. Find it in Tasks → Done.' : 'Task reopened.';
    await load();
  }).then(() => { if (!error.value) return focusList(); });
}
function save(task: Task, draft: TaskDraft, confirmed = false) {
  if (draft.status === 'done' && task.status !== 'done' && !confirmed) { completion.value = { task, draft }; return Promise.resolve(); }
  return run(async () => {
    await api(`/tasks/${task.id}`, 'PATCH', {
      version: draft.version, title: draft.title.trim(), notes: draft.notes.trim() || null,
      status: draft.status, priority: draft.priority, dependsOn: draft.dependsOn, plannedDate: draft.plannedDate || null,
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
  void activity();
  // Clerk session tokens are short-lived: obtain a renewed token, not a forced logout every minute.
  if (session.value?.expiresAt && session.value.expiresAt <= Date.now() + 30_000) {
    if (online.value) void checkSession();
    else if (session.value.expiresAt <= Date.now()) {
      deactivateDrafts();
      authState.value = 'signin';
      session.value = null;
      clearPrivateView();
    }
  }
  const day = currentDay();
  if (day !== today.value) {
    if (!capture.value.title && capture.value.plannedDate === today.value) capture.value.plannedDate = day;
    today.value = day;
  }
}
function wentOnline() { online.value = true; void reload(); }
function wentOffline() { online.value = false; ++sequence; loading.value = false; }
function returnedToPage(event: PageTransitionEvent) {
  if (!event.persisted) return;
  clearPrivateView();
  authState.value = 'loading';
  void reload();
}
onMounted(() => {
  void reload();
  clockTimer = setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', visibilityChanged);
  document.addEventListener('pointerdown', interacted, { passive: true });
  document.addEventListener('keydown', interacted);
  window.addEventListener('online', wentOnline);
  window.addEventListener('offline', wentOffline);
  window.addEventListener('pageshow', returnedToPage);
});
onUnmounted(() => {
  disposed = true;
  ++sequence;
  clearTimeout(reloadTimer);
  clearInterval(clockTimer);
  document.removeEventListener('visibilitychange', visibilityChanged);
  document.removeEventListener('pointerdown', interacted);
  document.removeEventListener('keydown', interacted);
  deactivateDrafts();
  window.removeEventListener('online', wentOnline);
  window.removeEventListener('offline', wentOffline);
  window.removeEventListener('pageshow', returnedToPage);
});
</script>

<template>
  <ConfirmDialog v-if="completion && authState === 'ready'" title="Done with this task?" :description="`Mark “${completion.task.title}” as complete? You can reopen it later.${completion.task.dependsOn && completion.task.dependencyStatus !== 'done' ? ' Its prerequisite must be completed first.' : ''}`" :busy="busy" @confirm="confirmCompletion" @cancel="completion = null" />
  <div class="app-shell">
    <aside class="sidebar">
      <a href="/" class="brand" aria-label="PlanWatch home"><span class="brand-icon"><Check :size="21" :stroke-width="3" /></span>PlanWatch<span class="version">2.0</span></a>
      <div class="workspace-label">YOUR SPACE</div>
      <nav class="workspace-nav" aria-label="Workspace">
        <button v-for="item in ([{ id: 'today', title: 'Today', icon: CalendarDays }, { id: 'tasks', title: 'Tasks', icon: ListTodo }, { id: 'trash', title: 'Trash', icon: Trash2 }] as const)" :key="item.id" :class="{ active: view === item.id }" :aria-current="view === item.id ? 'page' : undefined" :disabled="busy" @click="chooseView(item.id)"><component :is="item.icon" :size="19" />{{ item.title }}</button>
        <button v-if="session?.canAdmin" :class="{ active: view === 'admin' }" :aria-current="view === 'admin' ? 'page' : undefined" :disabled="busy" @click="chooseView('admin')"><Shield :size="19" />Administration</button>
      </nav>
      <div class="sidebar-note"><span class="small-dot"></span> One step at a time<p>A little less to remember.<br>A little more room to focus.</p></div>
      <div class="preview-label">{{ accountId ? 'Private workspace' : 'Local preview' }}<span>Plan a little. Focus a little.</span></div>
    </aside>

    <main>
      <header class="topbar">
        <span class="workspace-heading">Your personal workspace</span>
        <div class="topbar-actions">
          <span class="local-badge"><component v-if="!online" :is="WifiOff" :size="15" /><span v-else class="small-dot"></span>{{ !online ? 'Offline' : session?.mode === 'clerk' ? 'Private workspace' : 'On this computer' }}</span>
          <button v-if="canInstall" class="icon-button" type="button" aria-label="Install PlanWatch" title="Install PlanWatch" @click="install"><Download :size="19" /></button>
          <button v-if="accountId" class="icon-button sign-out" type="button" :disabled="busy" aria-label="Sign out" title="Sign out" @click="clearPrivateView(); deactivateDrafts(); emit('signOut')"><LogOut :size="18" /></button>
          <button class="theme-toggle" type="button" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleTheme">
            <component :is="isDark ? Sun : Moon" :key="isDark ? 'sun' : 'moon'" :size="20" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div class="content">
        <section v-if="authState === 'invite' || authState === 'banned'" class="admin-card enrollment" aria-labelledby="access-title">
          <h1 id="access-title">{{ authState === 'banned' ? 'Access paused' : 'Your own private workspace' }}</h1>
          <p v-if="authState === 'banned'">Your account has been banned. Contact the administrator to restore access. Your tasks are preserved.</p>
          <form v-else class="enrollment-form" @submit.prevent="join">
            <p>Ask the administrator for an invitation, then create your personal space.</p>
            <label>Your display name<input v-model="displayName" required maxlength="80" autocomplete="nickname" :disabled="joining" /></label>
            <label>Invitation link or code<input v-model="inviteInput" required autocomplete="off" spellcheck="false" :disabled="joining" /></label>
            <label class="usage-consent"><input v-model="usageAcknowledged" type="checkbox" required :disabled="joining" /><span>I understand that my tasks stay private, and the administrator can see my display name, task counts, observed sessions and estimated active time.</span></label>
            <button class="primary" :disabled="joining || !online || !usageAcknowledged || !displayName.trim() || !inviteInput.trim()">{{ joining ? 'Creating workspace…' : 'Accept invitation' }}</button>
          </form>
          <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        </section>
        <AdminPanel v-else-if="view === 'admin' && session?.canAdmin && authState === 'ready'" @failure="showError" />
        <template v-else>
        <div class="heading-row">
          <div><p class="eyebrow">{{ view === 'today' ? 'MAKE ROOM FOR WHAT MATTERS' : view === 'trash' ? 'NOTHING LOST IN A CLICK' : 'YOUR PLANS, YOUR PACE' }}</p><h1>{{ heading }}</h1><p class="intro">{{ description }}</p></div>
          <button class="icon-button refresh" aria-label="Refresh tasks" :disabled="busy || loading" @click="reload"><RefreshCw :size="18" :class="{ spin: loading }" /></button>
        </div>

        <div v-if="!online" class="connection-banner" role="status"><WifiOff :size="18" /><span>You’re offline. You can keep writing drafts; reconnect to load or save tasks.</span></div>
        <div v-if="authState === 'signin'" class="connection-banner" role="alert"><span>{{ error || 'Sign in again to continue. Your drafts are kept on this device.' }}</span><button v-if="accountId" class="secondary" @click="emit('signIn')">Switch account</button><a v-else class="secondary" href="/">Sign in again</a></div>
        <p v-if="accountId && (setupRequired || authState === 'signin')" class="capture-hint account-reference">Account reference: <code>{{ accountId }}</code></p>
        <div v-if="installHelp" class="connection-banner" role="status"><span>{{ installHelp }}</span><button class="icon-button" aria-label="Dismiss installation instructions" @click="installHelp = ''"><X :size="17" /></button></div>
        <div v-if="appUpdate" class="connection-banner" role="status"><span>An app update is ready. Save your changes before reloading.</span><button class="secondary" :disabled="busy" @click="applyUpdate">Reload app</button></div>
        <p v-if="registrationError" class="capture-hint">The offline screen could not be prepared. You can keep using PlanWatch online.</p>

        <template v-if="view !== 'trash' && authState === 'ready'">
          <form class="capture" @submit.prevent="add">
            <div class="capture-main"><Plus :size="22" aria-hidden="true" /><input ref="titleInput" v-model="capture.title" aria-label="New task title" placeholder="What would you like to do?" maxlength="200" required aria-describedby="capture-help" :disabled="busy" /><button class="primary" :disabled="!canWrite || !capture.title.trim() || busy" type="submit"><Plus :size="17" /><span>Add task</span></button></div>
            <div class="capture-options"><label class="priority-select">Priority<select v-model="capture.priority" :disabled="busy"><option v-for="priority in priorities" :key="priority" :value="priority">{{ priority.charAt(0).toUpperCase() + priority.slice(1) }}</option></select></label><DependencyPicker v-model="capture.dependsOn" :disabled="busy || !canWrite" @failure="showError" /></div>
            <fieldset class="capture-schedule" :disabled="busy"><label class="capture-date"><CalendarDays :size="15" /><span class="sr-only">Planned day for new task, optional</span><input v-model="capture.plannedDate" type="date" min="0001-01-01" max="9999-12-31" /></label><button class="date-chip" type="button" @click="capture.plannedDate = today">Today</button><button class="date-chip" type="button" @click="capture.plannedDate = nextDay(today)">Tomorrow</button><button class="date-chip" type="button" @click="capture.plannedDate = ''">No date</button></fieldset>
          </form>
          <p id="capture-help" class="capture-hint">Write a title, then tap Add task. Priority defaults to Medium. Dates and prerequisites are optional.{{ !storageAvailable ? ' Drafts will last only while this page stays open.' : '' }}</p>
        </template>

        <div v-if="error && authState !== 'signin'" role="alert" class="error-message">{{ error }} <button :disabled="busy || loading || !online" @click="reload">Refresh tasks</button></div>
        <div class="status-message" role="status" aria-live="polite"><span>{{ notice || (busy ? 'Saving…' : '') }}</span><button v-if="lastDeleted" class="undo-button" :disabled="!canWrite || busy || loading" @click="restore(lastDeleted)"><RotateCcw :size="15" />Undo last delete</button></div>

        <label v-if="authState === 'ready'" class="priority-filter">Filter by priority<select v-model="priorityFilter" :disabled="busy"><option value="all">All priorities</option><option v-for="priority in priorities" :key="priority" :value="priority">{{ priority.charAt(0).toUpperCase() + priority.slice(1) }}</option></select></label>
        <div class="list-toolbar">
          <div v-if="view === 'tasks'" class="filters" aria-label="Filter tasks"><button v-for="option in (['open', 'done', 'all'] as const)" :key="option" :aria-pressed="status === option" :class="{ active: status === option }" :disabled="busy" @click="status = option">{{ option === 'open' ? 'Open' : option === 'done' ? 'Done' : 'All' }}</button></div>
          <h2 v-else class="section-label">{{ view === 'today' ? 'Your next steps' : 'Deleted tasks' }}</h2>
          <label v-if="authState === 'ready'" class="search-control"><Search :size="16" /><span class="sr-only">Search {{ view === 'trash' ? 'Trash' : view === 'today' ? 'Today' : 'tasks' }}</span><input v-model="search" type="search" maxlength="200" :placeholder="view === 'trash' ? 'Search Trash…' : 'Search tasks…'" :disabled="busy" /><button v-if="search" type="button" class="icon-button" aria-label="Clear search" :disabled="busy" @click="search = ''"><X :size="16" /></button></label>
        </div>

        <section ref="listRegion" class="task-list" tabindex="-1" aria-label="Tasks" :aria-busy="loading || busy">
          <div v-if="loading && !tasks.length" class="empty-state"><LoaderCircle class="spin" :size="28" /><h2>Loading your tasks…</h2></div>
          <div v-else-if="!online && !tasks.length" class="empty-state"><WifiOff :size="28" /><h2>Your workspace is waiting.</h2><p>Reconnect to load your saved tasks.</p></div>
          <div v-else-if="!tasks.length" class="empty-state"><span class="empty-icon"><component :is="view === 'trash' ? Trash2 : CircleCheck" :size="29" /></span><h2>{{ error ? 'Your tasks could not be loaded.' : search.trim() ? 'No matching tasks.' : view === 'trash' ? 'Your Trash is empty.' : view === 'today' ? 'A little breathing room.' : status === 'done' ? 'A fresh start.' : 'A place for your next step.' }}</h2><p>{{ error ? 'Try refreshing. Your saved tasks have not been removed.' : search.trim() ? 'Try another word or clear the search.' : view === 'trash' ? 'Deleted tasks will stay here until you restore them.' : view === 'today' ? 'Nothing open is planned for today or earlier. Add something above, or look in Tasks.' : status === 'done' ? 'Completed tasks will appear here.' : 'Capture a task above when something comes to mind.' }}</p><button v-if="view === 'today' && !search && !error" class="secondary" :disabled="busy" @click="chooseView('tasks')">Browse all tasks</button></div>
          <article v-for="task in tasks" :key="task.id" class="task" :class="{ completed: task.status === 'done', expanded: editing === task.id }">
            <div class="task-row">
              <span v-if="view === 'trash'" class="trash-marker"><Trash2 :size="18" /></span>
              <button v-else class="checkbox" :class="{ checked: task.status === 'done' }" :aria-label="`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`" :disabled="!canWrite || busy || loading || editing === task.id || !!drafts[task.id]" @click="requestToggle(task)"><Check v-if="task.status === 'done'" :size="15" /></button>
              <component :is="view === 'trash' ? 'div' : 'button'" class="task-title" :aria-expanded="view === 'trash' ? undefined : editing === task.id" :disabled="view === 'trash' ? undefined : busy || loading" @click="view !== 'trash' && (editing = editing === task.id ? null : task.id)">
                <span>{{ task.title }}</span>
                <span class="task-meta"><span class="priority-badge" :data-priority="task.priority || 'medium'">{{ task.priority || 'medium' }}</span><span v-if="task.dependsOn">{{ task.dependencyStatus === 'done' ? 'Prerequisite done' : 'Waiting for' }} · {{ task.dependencyTitle || 'prerequisite' }}</span><span v-if="task.plannedDate" :class="{ overdue: task.status !== 'done' && task.plannedDate < today }">{{ task.status !== 'done' && task.plannedDate < today ? 'Overdue · ' : '' }}{{ task.plannedDate === today ? 'Today' : task.plannedDate === nextDay(today) ? 'Tomorrow' : formatDay(task.plannedDate) }}</span><span v-else>No date</span><span v-if="task.status === 'doing'" class="doing-dot">In progress</span><span v-if="task.estimateMinutes">{{ task.estimateMinutes }} min estimated</span><span v-if="drafts[task.id]">Unsaved draft</span><span v-else-if="task.notes">Has notes</span></span>
              </component>
              <button v-if="view === 'trash'" class="restore-button secondary" :aria-label="`Restore ${task.title}`" :disabled="!canWrite || busy || loading" @click="restore(task)"><RotateCcw :size="16" />Restore</button>
              <button v-if="view !== 'trash'" class="icon-button task-delete" :aria-label="`Delete ${task.title}`" :disabled="!canWrite || busy || loading" @click="remove(task)"><Trash2 :size="17" /></button>
              <button v-if="view !== 'trash'" class="icon-button" :aria-label="`${editing === task.id ? 'Close details for' : 'Edit'} ${task.title}`" :aria-expanded="editing === task.id" :disabled="busy || loading" @click="editing = editing === task.id ? null : task.id"><ChevronDown :size="18" :class="{ flipped: editing === task.id }" /></button>
            </div>
            <TaskEditor v-if="editing === task.id && view !== 'trash'" :task="task" :disabled="busy || loading" :can-save="canWrite" :today="today" @save="save(task, $event)" @failure="showError" @delete="remove(task)" @close="editing = null" />
          </article>
        </section>
        <div class="list-bottom"><span v-if="tasks.length">{{ tasks.length }} {{ tasks.length === 1 ? 'task' : 'tasks' }}{{ cursor ? ' loaded · more available' : '' }}</span><button v-if="cursor" class="secondary" :disabled="busy || loading" @click="run(() => load(true))">{{ loading ? 'Loading…' : 'Load more' }}</button></div>
        <footer><span class="small-dot"></span>{{ session?.mode === 'clerk' ? 'Saved privately in your workspace.' : accountId ? 'Your private workspace.' : 'Local development workspace.' }}<span v-if="lastSynced">Last refreshed {{ new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(lastSynced) }} · {{ TIME_ZONE }}</span></footer>
        </template>
      </div>
    </main>
  </div>
</template>
