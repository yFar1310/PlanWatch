<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { CalendarDays, CalendarRange, Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Clock3, Download, Lightbulb, ListTodo, LoaderCircle, LockKeyhole, LogOut, Moon, PanelLeft, Plus, RefreshCw, RotateCcw, Search, Shield, Sun, Trash2, WifiOff, X } from '@lucide/vue';
import { priorities, type TaskPriority, type Task, type TaskPage, type TrashSummary } from '../shared/tasks';
import type { SessionInfo } from '../shared/session';
import { currentDay, formatDay, nextDay, TIME_ZONE } from '../shared/calendar';
import { api, ApiError } from './api';
import { activateDrafts, deactivateDrafts, capture,ideaCapture,clearDraft, drafts, storageAvailable, type TaskDraft } from './drafts';
import { useTheme } from './theme';
import CaptureDialog from './CaptureDialog.vue';
import TimelineView from './TimelineView.vue';
import TaskDetailsDialog from './TaskDetailsDialog.vue';
import ScheduleFields from './ScheduleFields.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import DependencyPicker from './DependencyPicker.vue';
import AdminPanel from './AdminPanel.vue';
import { pendingInvitation, invitationCode, clearInvitation } from './invitations';
import TaskEditor from './TaskEditor.vue';
import TaskListing from './TaskListing.vue';
import ScheduleProposalDialog from './ScheduleProposalDialog.vue';
import UserGuideDialog from './UserGuideDialog.vue';
import { usePwa } from './pwa';

const props = defineProps<{ accountId?: string; profileName?:string }>();
const emit = defineEmits<{ signOut: []; signIn: [] }>();
type View = 'today' | 'tasks' | 'trash' | 'admin' | 'timeline' | 'ideas';
const view = ref<View>('today');
const viewLabel = computed(() => ({ today: 'Today', tasks: 'All tasks', trash: 'Trash', timeline: 'Calendar', admin: 'Administration',ideas:'Ideas' })[view.value]);
const sidebarKey = 'planwatch:sidebar-collapsed';
const sidebarCollapsed = ref(false);
try { sidebarCollapsed.value = localStorage.getItem(sidebarKey) === 'true'; } catch { /* The drawer works without storage. */ }
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  try { localStorage.setItem(sidebarKey, String(sidebarCollapsed.value)); } catch { /* Keep the choice for this page. */ }
}
const status = ref<'open' | 'done' | 'all'>('open');
const search = ref('');
const priorityFilter = ref<TaskPriority | 'all'>('all');
const completion = ref<{ task: Task; draft?: TaskDraft } | null>(null);
const logoutConfirmation=ref(false);
const guideOpen=ref(false);
function confirmSignOut(){
  if(!logoutConfirmation.value||busy.value)return;
  logoutConfirmation.value=false;clearPrivateView();deactivateDrafts();emit('signOut');
}
const tasks = ref<Task[]>([]);
const calendarCapture = ref(false);
const timelineTask = ref<Task|null>(null);
const timelineRevision = ref(0);
const planningTask=ref<Task|null>(null),lastIdea=ref<Task|null>(null),upNext=ref<Task|null>(null);
const ideaInput=ref<HTMLInputElement|null>(null);
function openPlanner(task:Task){
  if(drafts.value[task.id]){error.value='Save or discard this activity’s draft in its details before finding a time.';return;}
  error.value='';planningTask.value=task;
}
async function planned(task:Task){planningTask.value=null;lastIdea.value=null;notice.value=`${task.title} is planned for ${formatDay(task.plannedDate!)} · ${task.startTime}–${task.endTime}.`;try{await load();}catch(problem){showError(problem);}}
const trashInfo = ref<TrashSummary>({count:0,cutoff:0});
const selectedTrash = ref<Task[]>([]);
const purgeConfirmation = ref<{items:Task[];cutoff?:number;count:number}|null>(null);
const selectedIds = computed(()=>new Set(selectedTrash.value.map(task=>task.id)));
const allLoadedSelected = computed(()=>tasks.value.length>0 && tasks.value.slice(0,100).every(task=>selectedIds.value.has(task.id)));
function selectTrash(task:Task){selectedTrash.value=selectedIds.value.has(task.id)?selectedTrash.value.filter(item=>item.id!==task.id):[...selectedTrash.value,task].slice(0,100);}
function selectLoaded(){selectedTrash.value=allLoadedSelected.value?[]:tasks.value.slice(0,100);}
function requestPurge(items:Task[]){purgeConfirmation.value={items:[...items],count:items.length};}
async function requestEmptyTrash(){await run(async()=>{const summary=await api<TrashSummary>('/trash/summary');if(!summary.count){notice.value='Your Trash is already empty.';await load();return;}purgeConfirmation.value={items:[],count:summary.count,cutoff:summary.cutoff};});}
async function confirmPurge(){
  const pending=purgeConfirmation.value;if(!pending)return;
  await run(async()=>{
    const result= pending.cutoff!==undefined ? await api<{deleted:number;ids:string[]}>('/trash/empty','POST',{cutoff:pending.cutoff,confirmed:true})
      : pending.items.length===1 ? await api<{deleted:number;ids:string[]}>(`/trash/${pending.items[0]!.id}`,'DELETE',{version:pending.items[0]!.version,confirmed:true})
      : await api<{deleted:number;ids:string[]}>('/trash/purge','POST',{items:pending.items.map(task=>({id:task.id,version:task.version})),confirmed:true});
    result.ids.forEach(clearDraft);
    if(lastDeleted.value&&result.ids.includes(lastDeleted.value.id))lastDeleted.value=null;
    selectedTrash.value=[];notice.value=`${result.deleted} ${result.deleted===1?'task':'tasks'} permanently deleted.`;
    await load();
  });
  purgeConfirmation.value=null;
}
function openTimelineTask(task:Task){error.value='';timelineTask.value=task;}
async function planFromTimeline(day:string,time?:string,endTime?:string,endDay?:string){
  capture.value.plannedDate=day;capture.value.plannedEndDate=endDay&&endDay!==day?endDay:'';capture.value.startTime=time||'';
  const end=time?Math.min(1439,Number(time.slice(0,2))*60+Number(time.slice(3))+60):0;
  capture.value.endTime=endTime||(time?`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`:'');
  error.value='';calendarCapture.value=true;
}
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
const inviteInput = ref('');
const detectedInvitation = computed(()=>invitationCode(pendingInvitation.value));
const enrollmentCode = computed(()=>detectedInvitation.value || invitationCode(inviteInput.value));
const displayName = ref('');
const enrollmentName = computed(()=>displayName.value.trim() || props.profileName?.trim().slice(0,80) || 'PlanWatch member');
const usageAcknowledged = ref(false);
const joining = ref(false);
const setupRequired = ref(false);
const lastSynced = ref<number | null>(null);
const canWrite = computed(() => online.value && authState.value === 'ready');
const { canInstall, help: installHelp, install, update: appUpdate, applyUpdate, registrationError } = usePwa();
const today = ref(currentDay());
const { isDark, toggle: toggleTheme } = useTheme();
const titleInput = ref<HTMLInputElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const listRegion = ref<HTMLElement | null>(null);
const heading = computed(() => view.value === 'today' ? 'Make room for what matters.' : view.value === 'trash' ? 'Room to reconsider.' : view.value==='ideas'?'An idea today. A plan when you’re ready.':'Everything in one place.');
const description = computed(() => view.value === 'today' ? `${formatDay(today.value)} · Today and overdue · ${TIME_ZONE}` : view.value === 'trash' ? 'Deleted tasks stay here. Restore them whenever you need.' : view.value==='ideas'?'Your open activities without a date. Keep them here, refine them, or find a time.':'Your plans, in progress and at your own pace.');
let sequence = 0;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
let checkingSession = false;

async function load(append = false) {
  if (disposed || authState.value !== 'ready' || view.value === 'admin') return;
  if(view.value==='timeline'){timelineRevision.value++;loading.value=false;return;}
  const request = ++sequence;
  loading.value = true;
  if (!online.value) { loading.value = false; throw new Error('Reconnect to refresh your tasks.'); }
  const query = new URLSearchParams({ view: view.value, status: view.value === 'tasks' ? status.value : 'all', q: search.value.trim(), priority: priorityFilter.value });
  if (view.value === 'today') query.set('day', today.value);
  if (append && cursor.value) query.set('cursor', cursor.value);
  try {
    const [page,summary,next] = await Promise.all([api<TaskPage>(`/tasks?${query}`),view.value==='trash'?api<TrashSummary>('/trash/summary'):Promise.resolve(null),view.value==='today'?api<{task:Task|null}>('/planning/next'):Promise.resolve(null)]);
    if (request !== sequence || disposed || authState.value !== 'ready') return;
    if(summary)trashInfo.value=summary;
    upNext.value=next?.task||null;
    if(!append)selectedTrash.value=[];
    tasks.value = append ? [...tasks.value, ...page.items.filter(task => !tasks.value.some(old => old.id === task.id))] : page.items;
    cursor.value = page.nextCursor;
    lastSynced.value = Date.now();
  } catch (problem) {
    if (request === sequence && !disposed) throw problem;
  } finally { if (request === sequence && !disposed) loading.value = false; }
}
function clearPrivateView() { logoutConfirmation.value=false;planningTask.value=null;lastIdea.value=null;upNext.value=null;calendarCapture.value=false; timelineTask.value=null;purgeConfirmation.value=null;selectedTrash.value=[];trashInfo.value={count:0,cutoff:0}; completion.value = null; ++sequence; loading.value = false; tasks.value = []; cursor.value = null; editing.value = null; lastDeleted.value = null; lastSynced.value = null; }
function showError(problem: unknown) {
  if (disposed) return;
  error.value = problem instanceof Error ? problem.message : 'Something went wrong. Please try again.';
  if(problem instanceof ApiError && problem.code==='task_permanently_deleted'){capture.value.key=null;capture.value.payload=null;ideaCapture.value.key=null;ideaCapture.value.payload=null;error.value='The earlier activity was permanently deleted. Your draft is kept. Submit again to create a new activity.';}
  setupRequired.value = problem instanceof ApiError && problem.code === 'setup_required';
  if (problem instanceof ApiError && [401, 403].includes(problem.status)) {
    authState.value = problem.code === 'invitation_required' ? 'invite' : problem.code === 'account_banned' ? 'banned' : 'signin';
    deactivateDrafts();
    session.value = null;
    clearPrivateView();
    if (problem.code === 'invitation_required') error.value = '';
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
  const code = enrollmentCode.value;
  if (!code) { error.value = 'Open the invitation link you received, or paste it below.'; return; }
  joining.value = true; error.value = '';
  try {
    await api('/invitations/accept', 'POST', { code, displayName: enrollmentName.value, usageAcknowledged: true });
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
  selectedTrash.value=[];purgeConfirmation.value=null;
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
      try {
        if(timelineTask.value){const id=timelineTask.value.id;const saved=await api<{task:Task}>(`/tasks/${id}`);if(!disposed&&timelineTask.value?.id===id)timelineTask.value=saved.task;}
        await load();
      } catch { /* Keep the original conflict message and draft. */ }
    }
  } finally { busy.value = false; }
}
function chooseView(value: View) { if (!busy.value) { if(value!==view.value)lastIdea.value=null;view.value = value; search.value = ''; } }
async function beginTask() {
  chooseView('tasks');
  await nextTick();
  titleInput.value?.focus();
}
async function focusSearch() {
  chooseView('tasks');
  await nextTick();
  searchInput.value?.focus();
}
function keyboardShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && authState.value === 'ready' && !busy.value && !completion.value && !purgeConfirmation.value && !timelineTask.value && !calendarCapture.value&&!planningTask.value&&!logoutConfirmation.value&&!guideOpen.value) {
    event.preventDefault(); void focusSearch();
  }
}
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
    const schedule = {plannedEndDate:capture.value.plannedEndDate||null,startTime:capture.value.startTime||null,endTime:capture.value.endTime||null};
    const payload = JSON.stringify({ title, plannedDate, ...schedule, priority: capture.value.priority, dependsOn: capture.value.dependsOn });
    let previousPayload = capture.value.payload;
    try {
      const previous = JSON.parse(previousPayload ?? 'null');
      if (previous && typeof previous === 'object') previousPayload = JSON.stringify({ title: previous.title, plannedDate: previous.plannedDate ?? null, plannedEndDate:previous.plannedEndDate??null,startTime:previous.startTime??null,endTime:previous.endTime??null, priority: previous.priority ?? 'medium', dependsOn: previous.dependsOn ?? null });
    } catch { /* An unreadable draft receives a new request key. */ }
    if (previousPayload !== payload || !capture.value.key) {
      capture.value = { ...capture.value, key: crypto.randomUUID(), payload };
    }
    capture.value.payload = payload;
    await api<{ task: Task }>('/tasks', 'POST', { title, plannedDate, ...schedule, priority: capture.value.priority, dependsOn: capture.value.dependsOn }, capture.value.key!);
    capture.value = { plannedEndDate:'',startTime:'',endTime:'',title: '', plannedDate: capture.value.plannedDate, key: null, payload: null, priority: 'medium', dependsOn: null };
    calendarCapture.value=false;
    notice.value = plannedDate ? `Added for ${formatDay(plannedDate)}. Find all your tasks in Tasks.` : 'Added without a date. Find it in Tasks.';
    await load();
  }, true);
  await nextTick();
  if (!error.value) titleInput.value?.focus();
}
async function addIdea(){
  const title=ideaCapture.value.title.trim();if(!title)return;
  await run(async()=>{
    const payload=JSON.stringify({title,plannedDate:null});
    if(ideaCapture.value.payload!==payload||!ideaCapture.value.key)ideaCapture.value={title:ideaCapture.value.title,key:crypto.randomUUID(),payload};
    const saved=await api<{task:Task}>('/tasks','POST',{title,plannedDate:null},ideaCapture.value.key!);
    if(disposed)return;
    lastIdea.value=saved.task;ideaCapture.value={title:'',key:null,payload:null};notice.value='Idea saved without a date. Find it in Ideas, or give it a time when you’re ready.';
    await load();
  },true);
  await nextTick();if(!error.value)ideaInput.value?.focus();
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
      status: draft.status, priority: draft.priority, dependsOn: draft.dependsOn, plannedDate: draft.plannedDate || null, plannedEndDate:draft.plannedEndDate||null,startTime:draft.startTime||null,endTime:draft.endTime||null,
      estimateMinutes: draft.estimate === '' ? null : Number(draft.estimate),
      actualMinutes: draft.actual === '' ? null : Number(draft.actual),
    });
    clearDraft(task.id);
    if(lastIdea.value?.id===task.id)lastIdea.value=null;
    editing.value = null;timelineTask.value=null;
    notice.value = 'Changes saved.';
    await load();
  }).then(() => { if (!error.value) return focusList(); });
}
function remove(task: Task) {
  return run(async () => {
    const saved = await api<{ task: Task }>(`/tasks/${task.id}`, 'DELETE', { version: task.version });
    lastDeleted.value = saved.task;
    clearDraft(task.id);
    editing.value = null;timelineTask.value=null;
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
  document.addEventListener('keydown', keyboardShortcut);
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
  document.removeEventListener('keydown', keyboardShortcut);
  deactivateDrafts();
  window.removeEventListener('online', wentOnline);
  window.removeEventListener('offline', wentOffline);
  window.removeEventListener('pageshow', returnedToPage);
});
</script>

<template>
  <UserGuideDialog v-if="guideOpen" @close="guideOpen=false" />
  <ConfirmDialog v-if="logoutConfirmation&&accountId" title="Sign out of PlanWatch?" description="Your saved activities stay in your private space. Unsaved drafts are kept on this device for your next sign-in." confirm-label="Sign out" cancel-label="Stay signed in" :busy="busy" @confirm="confirmSignOut" @cancel="logoutConfirmation=false" />
  <ScheduleProposalDialog v-if="planningTask && authState==='ready'" :task="planningTask" :today="today" :online="online" @close="planningTask=null" @scheduled="planned" @failure="showError" />
  <CaptureDialog v-if="calendarCapture && authState === 'ready'" v-model="capture" :today="today" :busy="busy" :can-save="canWrite" :error="error" @close="calendarCapture=false" @add="add" @failure="showError" />
  <TaskDetailsDialog v-if="timelineTask && authState === 'ready'" :task="timelineTask" :busy="busy" :can-save="canWrite" :today="today" :error="error" @close="timelineTask=null" @save="save(timelineTask!,$event)" @delete="remove(timelineTask!)" @failure="showError" />
  <ConfirmDialog v-if="purgeConfirmation && authState === 'ready'" title="Delete permanently?" :description="purgeConfirmation.cutoff !== undefined ? `Delete ${purgeConfirmation.count} tasks from your entire Trash, including other pages and hidden filters? Saved history is removed too. Tasks changed after this confirmation are kept. This cannot be undone.` : `Permanently delete ${purgeConfirmation.count===1 ? '“'+purgeConfirmation.items[0]!.title+'”' : purgeConfirmation.count+' selected tasks'} and their saved history? This cannot be undone.`" :confirm-label="purgeConfirmation.cutoff !== undefined ? 'Empty Trash permanently' : 'Delete permanently'" cancel-label="Cancel" danger :busy="busy" @confirm="confirmPurge" @cancel="purgeConfirmation=null" />
  <ConfirmDialog v-if="completion && authState === 'ready'" title="Done with this task?" :description="`Mark “${completion.task.title}” as complete? You can reopen it later.${completion.task.dependsOn && completion.task.dependencyStatus !== 'done' ? ' Its prerequisite must be completed first.' : ''}`" :busy="busy" @confirm="confirmCompletion" @cancel="completion = null" />
  <a class="skip-link" href="#workspace-content">Skip to workspace</a>
  <div class="app-shell desktop:bg-canvas">
    <aside id="workspace-sidebar" class="sidebar desktop:inset-y-0 desktop:left-0 desktop:z-30 desktop:w-[260px] desktop:overflow-y-auto desktop:border-0 desktop:bg-sidebar desktop:p-4 desktop:pt-6" :class="{ 'desktop:hidden': sidebarCollapsed }">
      <a href="/" class="brand desktop:px-3 desktop:text-lg" aria-label="PlanWatch home"><span class="brand-icon"><Check :size="21" :stroke-width="3" /></span>PlanWatch<span class="version">2.0</span></a>
      <div class="hidden desktop:mt-8 desktop:grid desktop:gap-1">
        <button class="sidebar-action" type="button" :disabled="busy || authState !== 'ready'" @click="beginTask"><Plus :size="18" />New task</button>
        <button class="sidebar-action" type="button" :disabled="busy || authState !== 'ready'" @click="focusSearch"><Search :size="18" />Search tasks<kbd class="ml-auto text-[10px] font-normal text-muted">⌘ / Ctrl K</kbd></button>
      </div>
      <div class="workspace-label desktop:mb-2 desktop:mt-8 desktop:px-3 desktop:tracking-widest">YOUR SPACE</div>
      <nav class="workspace-nav desktop:gap-1" aria-label="Workspace">
        <button v-for="item in ([{ id: 'today', title: 'Today', icon: CalendarDays }, { id: 'ideas', title: 'Ideas', icon: Lightbulb }, { id: 'tasks', title: 'Tasks', icon: ListTodo }, { id: 'timeline', title: 'Calendar', icon: CalendarRange }, { id: 'trash', title: 'Trash', icon: Trash2 }] as const)" :key="item.id" :class="{ active: view === item.id }" :aria-current="view === item.id ? 'page' : undefined" :disabled="busy" @click="chooseView(item.id)"><component :is="item.icon" :size="19" />{{ item.title }}</button>
        <button v-if="session?.canAdmin" :class="{ active: view === 'admin' }" :aria-current="view === 'admin' ? 'page' : undefined" :disabled="busy" @click="chooseView('admin')"><Shield :size="19" />Administration</button>
      </nav>
      <div class="sidebar-note desktop:hidden"><span class="small-dot"></span> One step at a time<p>A little less to remember.<br>A little more room to focus.</p></div>
      <div class="preview-label desktop:hidden">{{ accountId ? 'Private workspace' : 'Local preview' }}<span>Plan a little. Focus a little.</span></div>
      <div class="hidden desktop:mt-auto desktop:flex desktop:items-center desktop:gap-3 desktop:rounded-xl desktop:border desktop:border-solid desktop:border-line desktop:bg-canvas/60 desktop:p-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-selected text-sm font-semibold text-accent" aria-hidden="true">{{ session?.displayName?.charAt(0).toUpperCase() || 'P' }}</span>
        <div class="min-w-0"><p class="m-0 truncate text-sm font-medium text-ink">{{ session?.displayName || 'Your workspace' }}</p><p class="m-0 mt-1 flex items-center gap-1.5 text-xs font-normal text-muted"><LockKeyhole :size="11" />{{ accountId ? 'Private workspace' : 'Local preview' }}</p></div>
      </div>
    </aside>

    <main id="workspace-content" tabindex="-1" class="desktop:min-w-0 desktop:flex-1 desktop:w-auto desktop:transition-[margin-left] desktop:duration-200 motion-reduce:transition-none" :class="sidebarCollapsed ? 'desktop:ml-0' : 'desktop:ml-[260px]'">
      <header class="topbar desktop:sticky desktop:top-0 desktop:z-20 desktop:h-[72px] desktop:border-0 desktop:bg-canvas/90 desktop:px-6 desktop:backdrop-blur-xl">
        <div class="hidden desktop:flex desktop:min-w-0 desktop:items-center desktop:gap-3">
          <button class="icon-button drawer-toggle" type="button" :aria-label="sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'" :title="sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'" :aria-expanded="!sidebarCollapsed" aria-controls="workspace-sidebar" @click="toggleSidebar"><PanelLeft :size="20" /></button>
          <div class="flex min-w-0 items-center gap-2.5"><span class="text-sm font-semibold text-ink">PlanWatch</span><ChevronRight :size="13" class="text-muted" /><span class="truncate text-sm text-muted">{{ viewLabel }}</span></div>
        </div>
        <div class="topbar-actions desktop:gap-2">
          <span class="local-badge desktop:mr-3"><component v-if="!online" :is="WifiOff" :size="15" /><span v-else class="small-dot"></span>{{ !online ? 'Offline' : session?.mode === 'clerk' ? 'Private workspace' : 'On this computer' }}</span>
          <button class="icon-button" type="button" aria-label="User guide" title="User guide" @click="guideOpen=true"><CircleHelp :size="20" /></button>
          <button v-if="canInstall" class="icon-button" type="button" aria-label="Install PlanWatch" title="Install PlanWatch" @click="install"><Download :size="19" /></button>
          <button v-if="accountId" class="icon-button sign-out" type="button" :disabled="busy" aria-label="Sign out" title="Sign out" @click="logoutConfirmation=true"><LogOut :size="18" /></button>
          <button class="theme-toggle" type="button" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleTheme">
            <component :is="isDark ? Sun : Moon" :key="isDark ? 'sun' : 'moon'" :size="20" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div class="content desktop:mt-12 desktop:mb-12 desktop:mx-auto desktop:w-full desktop:px-10" :class="view==='timeline'?'desktop:max-w-[1320px]':view==='admin'?'desktop:max-w-[1140px]':'desktop:max-w-[1000px]'">
        <section v-if="authState === 'invite' || authState === 'banned'" class="admin-card enrollment" aria-labelledby="access-title">
          <h1 id="access-title">{{ authState === 'banned' ? 'Access paused' : 'Welcome to PlanWatch' }}</h1>
          <p v-if="authState === 'banned'">Your account has been banned. Contact the administrator to restore access. Your tasks are preserved.</p>
          <form v-else class="enrollment-form" @submit.prevent="join">
            <template v-if="detectedInvitation"><p class="invitation-detected"><Check :size="18" />Invitation link detected. You don’t need to paste it again.</p><p>Your tasks will have their own private space, separate from everyone else’s.</p></template>
            <template v-else><p>Open the invitation link you received to join. The regular app address doesn’t include an invitation.</p><details class="enrollment-fallback"><summary>I have a link to paste</summary><label>Invitation link or code<input v-model="inviteInput" aria-label="Invitation link or code" autocomplete="off" spellcheck="false" :disabled="joining" /></label></details></template>
            <p class="enrollment-identity">Joining as <strong>{{ enrollmentName }}</strong>{{ profileName && !displayName.trim() ? ' · from your sign-in profile' : '' }}</p>
            <details class="enrollment-fallback"><summary>Change display name (optional)</summary><label>Display name<input v-model="displayName" aria-label="Display name (optional)" :placeholder="profileName || 'PlanWatch member'" maxlength="80" autocomplete="nickname" :disabled="joining" /></label></details>
            <label class="usage-consent"><input v-model="usageAcknowledged" type="checkbox" required :disabled="joining" /><span>I understand that my tasks stay private, and the administrator can see my display name, task counts, observed sessions and estimated active time.</span></label>
            <button class="primary" :disabled="joining || !online || !usageAcknowledged || !enrollmentCode">{{ joining ? 'Joining…' : 'Join PlanWatch' }}</button>
            <button v-if="detectedInvitation" type="button" class="enrollment-other" :disabled="joining" @click="clearInvitation();inviteInput='';error=''">Use another invitation</button>
          </form>
          <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        </section>
        <AdminPanel v-else-if="view === 'admin' && session?.canAdmin && authState === 'ready'" @failure="showError" />
        <TimelineView v-else-if="view === 'timeline' && authState === 'ready'" :revision="timelineRevision" :online="online" :today="today" @failure="showError" @edit="openTimelineTask" @plan="planFromTimeline" @browse="chooseView('tasks')" />
        <template v-else>
        <div class="heading-row">
          <div><p class="eyebrow desktop:hidden">{{ view === 'today' ? 'MAKE ROOM FOR WHAT MATTERS' : view === 'trash' ? 'NOTHING LOST IN A CLICK' : 'YOUR PLANS, YOUR PACE' }}</p><h1><span class="desktop:hidden">{{ heading }}</span><span class="hidden desktop:inline">{{ viewLabel }}</span></h1><p class="intro">{{ description }}</p></div>
          <button title="Refresh tasks" class="icon-button refresh" aria-label="Refresh tasks" :disabled="busy || loading" @click="reload"><RefreshCw :size="18" :class="{ spin: loading }" /></button>
        </div>

        <div v-if="!online" class="connection-banner" role="status"><WifiOff :size="18" /><span>You’re offline. You can keep writing drafts; reconnect to load or save tasks.</span></div>
        <div v-if="authState === 'signin'" class="connection-banner" role="alert"><span>{{ error || 'Sign in again to continue. Your drafts are kept on this device.' }}</span><button v-if="accountId" class="secondary" @click="emit('signIn')">Switch account</button><a v-else class="secondary" href="/">Sign in again</a></div>
        <p v-if="accountId && (setupRequired || authState === 'signin')" class="capture-hint account-reference">Account reference: <code>{{ accountId }}</code></p>
        <div v-if="installHelp" class="connection-banner" role="status"><span>{{ installHelp }}</span><button title="Dismiss installation instructions" class="icon-button" aria-label="Dismiss installation instructions" @click="installHelp = ''"><X :size="17" /></button></div>
        <div v-if="appUpdate" class="connection-banner" role="status"><span>An app update is ready. Save your changes before reloading.</span><button class="secondary" :disabled="busy" @click="applyUpdate">Reload app</button></div>
        <p v-if="registrationError" class="capture-hint">The offline screen could not be prepared. You can keep using PlanWatch online.</p>

        <section v-if="(view==='today'||view==='ideas')&&authState==='ready'" class="idea-home" aria-labelledby="idea-heading">
          <div class="idea-lamp"><Lightbulb :size="30" :stroke-width="1.6" /></div>
          <p class="eyebrow">FROM A THOUGHT TO A REAL MOMENT</p><h2 id="idea-heading">What would you like to make time for?</h2>
          <p>A workout, a call, a little time to play. Keep the idea now; give it a place when you’re ready.</p>
          <form class="idea-capture" @submit.prevent="addIdea"><label class="sr-only" for="idea-title">New idea</label><input id="idea-title" ref="ideaInput" v-model="ideaCapture.title" aria-label="New idea" maxlength="200" required placeholder="Call mum, go for a walk, start a puzzle…" :disabled="busy" /><button class="primary" :disabled="!canWrite||busy||!ideaCapture.title.trim()"><Plus :size="17" />Save idea</button></form>
          <p class="idea-capture-help">Saved privately without a date. One idea at a time.{{ !storageAvailable?' This draft lasts only while this page stays open.':'' }}</p>
          <div v-if="lastIdea" class="idea-saved"><div role="status"><span><Check :size="14" /> IDEA SAVED</span><strong>{{ lastIdea.title }}</strong><small>You can leave it in Ideas. No scheduling required.</small></div><button class="secondary" :disabled="busy||loading||!canWrite" @click="openTimelineTask(lastIdea)"><Clock3 :size="16" />Choose date &amp; time</button><button v-if="view!=='ideas'" class="enrollment-other" :disabled="busy" @click="chooseView('ideas')">View ideas</button><button class="enrollment-other" :disabled="busy" @click="lastIdea=null">Keep for later</button><details class="idea-optional"><summary>Optional scheduling help</summary><p>Find the first free times in a window you choose.</p><button class="secondary" :disabled="busy||loading||!canWrite" @click="openPlanner(lastIdea)">Find available times</button></details></div>
        </section>
        <button v-if="view==='today'&&authState==='ready'&&upNext" class="next-activity" :disabled="busy||loading" @click="openTimelineTask(upNext)"><span class="next-icon"><Clock3 :size="20" /></span><span><small>NEXT ON YOUR SCHEDULE</small><strong>{{ upNext.title }}</strong><span>{{ upNext.startTime }}–{{ upNext.endTime }} · {{ TIME_ZONE }}</span></span><ChevronRight :size="18" /></button>
        <template v-if="view === 'tasks' && authState === 'ready'">
          <form class="capture desktop:rounded-2xl" @submit.prevent="add">
            <div class="capture-main"><Plus :size="22" aria-hidden="true" /><input ref="titleInput" v-model="capture.title" aria-label="New task title" placeholder="What would you like to do?" maxlength="200" required aria-describedby="capture-help" :disabled="busy" /><button class="primary" :disabled="!canWrite || !capture.title.trim() || busy" type="submit"><Plus :size="17" /><span>Add task</span></button></div>
            <div class="capture-options"><label class="priority-select">Priority<select v-model="capture.priority" :disabled="busy"><option v-for="priority in priorities" :key="priority" :value="priority">{{ priority.charAt(0).toUpperCase() + priority.slice(1) }}</option></select></label><DependencyPicker v-model="capture.dependsOn" :disabled="busy || !canWrite" @failure="showError" /></div>
            <fieldset class="capture-schedule" :disabled="busy"><label class="capture-date"><CalendarDays :size="15" /><span class="sr-only">Planned day for new task, optional</span><input v-model="capture.plannedDate" type="date" min="0001-01-01" max="9999-12-31" /></label><button class="date-chip" type="button" @click="capture.plannedDate = today">Today</button><button class="date-chip" type="button" @click="capture.plannedDate = nextDay(today)">Tomorrow</button><button class="date-chip" type="button" @click="capture.plannedDate = ''">No date</button></fieldset>
            <details class="capture-advanced"><summary>End date &amp; time{{ capture.startTime ? ` · ${capture.startTime}–${capture.endTime}` : capture.plannedEndDate ? ` · until ${formatDay(capture.plannedEndDate)}` : '' }}</summary><ScheduleFields :model-value="capture" :today="today" :disabled="busy" @update:model-value="Object.assign(capture,$event)" /></details>
          </form>
          <p id="capture-help" class="capture-hint">Write a title, then tap Add task. Priority defaults to Medium. Dates and prerequisites are optional.{{ !storageAvailable ? ' Drafts will last only while this page stays open.' : '' }}</p>
        </template>

        <div v-if="error && authState !== 'signin'" role="alert" class="error-message">{{ error }} <button :disabled="busy || loading || !online" @click="reload">Refresh tasks</button></div>
        <div class="status-message" role="status" aria-live="polite"><span>{{ notice || (busy ? 'Saving…' : '') }}</span><button v-if="lastDeleted" class="undo-button" :disabled="!canWrite || busy || loading" @click="restore(lastDeleted)"><RotateCcw :size="15" />Undo last delete</button></div>

        <div class="task-controls desktop:mt-6 desktop:mb-4 desktop:flex desktop:flex-wrap desktop:items-center desktop:gap-4">
        <label v-if="authState === 'ready'" class="priority-filter desktop:order-2 desktop:m-0 desktop:gap-2"><span class="desktop:hidden">Filter by priority</span><span class="hidden desktop:inline">Priority</span><select v-model="priorityFilter" :disabled="busy"><option value="all">All priorities</option><option v-for="priority in priorities" :key="priority" :value="priority">{{ priority.charAt(0).toUpperCase() + priority.slice(1) }}</option></select></label>
        <div class="list-toolbar desktop:contents">
          <div v-if="view === 'tasks'" class="filters desktop:order-1" aria-label="Filter tasks"><button v-for="option in (['open', 'done', 'all'] as const)" :key="option" :aria-pressed="status === option" :class="{ active: status === option }" :disabled="busy" @click="status = option">{{ option === 'open' ? 'Open' : option === 'done' ? 'Done' : 'All' }}</button></div>
          <h2 v-else class="section-label desktop:order-1">{{ view === 'today' ? 'Your next steps' : view==='ideas'?'Ideas to make room for':'Deleted tasks' }}</h2>
          <label v-if="authState === 'ready'" class="search-control desktop:order-3 desktop:ml-auto desktop:mb-0 desktop:w-[235px]"><Search :size="16" /><span class="sr-only">Search {{ view === 'trash' ? 'Trash' : view === 'today' ? 'Today' : 'tasks' }}</span><input ref="searchInput" v-model="search" type="search" maxlength="200" :placeholder="view === 'trash' ? 'Search Trash…' : view==='ideas'?'Search ideas…':'Search tasks…'" :disabled="busy" /><button title="Clear search" v-if="search" type="button" class="icon-button" aria-label="Clear search" :disabled="busy" @click="search = ''"><X :size="16" /></button></label>
        </div>

        </div>

        <div v-if="view === 'trash' && authState === 'ready'" class="trash-actions"><label class="trash-select-all"><input type="checkbox" :checked="allLoadedSelected" :indeterminate="selectedTrash.length>0&&!allLoadedSelected" :disabled="busy||loading||!tasks.length" @change="selectLoaded" />Select loaded tasks</label><span>{{ selectedTrash.length }} selected · up to 100</span><button class="secondary" :disabled="!canWrite||busy||loading||!selectedTrash.length" @click="requestPurge(selectedTrash)">Delete selected</button><button class="delete-button" :disabled="!canWrite||busy||loading||!trashInfo.count" @click="requestEmptyTrash">Empty Trash ({{ trashInfo.count }})</button></div>
        <section ref="listRegion" class="task-list" tabindex="-1" aria-label="Tasks" :aria-busy="loading || busy">
          <div v-if="loading && !tasks.length" class="empty-state"><LoaderCircle class="spin" :size="28" /><h2>Loading your tasks…</h2></div>
          <div v-else-if="!online && !tasks.length" class="empty-state"><WifiOff :size="28" /><h2>Your workspace is waiting.</h2><p>Reconnect to load your saved tasks.</p></div>
          <div v-else-if="!tasks.length" class="empty-state"><span class="empty-icon"><component :is="view === 'trash' ? Trash2 : CircleCheck" :size="29" /></span><h2>{{ error ? 'Your tasks could not be loaded.' : search.trim() ? 'No matching tasks.' : view === 'trash' ? 'Your Trash is empty.' : view === 'today' ? 'A little breathing room.' : view==='ideas'?'A place for your next idea.':status === 'done' ? 'A fresh start.' : 'A place for your next step.' }}</h2><p>{{ error ? 'Try refreshing. Your saved tasks have not been removed.' : search.trim() ? 'Try another word or clear the search.' : view === 'trash' ? 'Deleted tasks will stay here until you restore them.' : view === 'today' ? 'Nothing open is planned for today or earlier. Capture an idea above or browse your tasks.' : view==='ideas'?'Capture an idea above. Your open tasks without a date also appear here.':status === 'done' ? 'Completed tasks will appear here.' : 'Capture a task above when something comes to mind.' }}</p><button v-if="view === 'today' && !search && !error" class="secondary" :disabled="busy" @click="chooseView('tasks')">Browse all tasks</button></div>
          <TaskListing :tasks="tasks" :disabled="busy||loading" :has-more="!!cursor" v-slot="{task}">
          <article class="task" :class="{ completed: task.status === 'done', expanded: editing === task.id }">
            <div class="task-row">
              <label v-if="view === 'trash'" class="trash-check"><span class="sr-only">Select {{ task.title }}</span><input type="checkbox" :checked="selectedIds.has(task.id)" :disabled="busy||loading||(!selectedIds.has(task.id)&&selectedTrash.length>=100)" @change="selectTrash(task)" /></label>
              <button :title="`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`" v-else class="checkbox" :class="{ checked: task.status === 'done' }" :aria-label="`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`" :disabled="!canWrite || busy || loading || editing === task.id || !!drafts[task.id]" @click="requestToggle(task)"><Check v-if="task.status === 'done'" :size="15" /></button>
              <component :is="view === 'trash' ? 'div' : 'button'" class="task-title" :aria-expanded="view === 'trash' ? undefined : editing === task.id" :disabled="view === 'trash' ? undefined : busy || loading" @click="view !== 'trash' && (editing = editing === task.id ? null : task.id)">
                <span>{{ task.title }}</span>
                <span class="task-meta"><span class="priority-badge" :data-priority="task.priority || 'medium'">{{ task.priority || 'medium' }}</span><span v-if="task.dependsOn">{{ task.dependencyStatus === 'done' ? 'Prerequisite done' : 'Waiting for' }} · {{ task.dependencyTitle || 'prerequisite' }}</span><span v-if="task.plannedDate" :class="{ overdue: task.status !== 'done' && task.plannedDate < today }">{{ task.status !== 'done' && task.plannedDate < today ? 'Overdue · ' : '' }}{{ task.plannedDate === today ? 'Today' : task.plannedDate === nextDay(today) ? 'Tomorrow' : formatDay(task.plannedDate) }}</span><span v-else>No date</span><span v-if="task.plannedEndDate && task.plannedEndDate !== task.plannedDate">until {{ formatDay(task.plannedEndDate) }}</span><span v-if="task.startTime">{{ task.startTime }}–{{ task.endTime }}</span><span v-if="task.status === 'doing'" class="doing-dot">In progress</span><span v-if="task.estimateMinutes">{{ task.estimateMinutes }} min estimated</span><span v-if="drafts[task.id]">Unsaved draft</span><span v-else-if="task.notes">Has notes</span></span>
              </component>
              <button :title="`Restore ${task.title}`" v-if="view === 'trash'" class="restore-button secondary" :aria-label="`Restore ${task.title}`" :disabled="!canWrite || busy || loading" @click="restore(task)"><RotateCcw :size="16" />Restore</button>
              <button :title="`Permanently delete ${task.title}`" v-if="view === 'trash'" class="icon-button task-delete" :aria-label="`Permanently delete ${task.title}`" :disabled="!canWrite||busy||loading" @click="requestPurge([task])"><Trash2 :size="17" /></button>
              <button :title="`Find available times for ${task.title}`" v-if="view==='ideas'" class="icon-button" :aria-label="`Find available times for ${task.title}`" :disabled="!canWrite||busy||loading" @click="openPlanner(task)"><Lightbulb :size="17" /></button>
              <button :title="`Plan ${task.title}`" v-if="view==='ideas'" class="icon-button idea-plan" :aria-label="`Plan ${task.title}`" :disabled="!canWrite||busy||loading" @click="openTimelineTask(task)"><Clock3 :size="17" /></button>
              <button :title="`Delete ${task.title}`" v-if="view !== 'trash'" class="icon-button task-delete" :aria-label="`Delete ${task.title}`" :disabled="!canWrite || busy || loading" @click="remove(task)"><Trash2 :size="17" /></button>
              <button :title="`${editing === task.id ? 'Close details for' : 'Edit'} ${task.title}`" v-if="view !== 'trash'" class="icon-button" :aria-label="`${editing === task.id ? 'Close details for' : 'Edit'} ${task.title}`" :aria-expanded="editing === task.id" :disabled="busy || loading" @click="editing = editing === task.id ? null : task.id"><ChevronDown :size="18" :class="{ flipped: editing === task.id }" /></button>
            </div>
            <TaskEditor v-if="editing === task.id && view !== 'trash'" :task="task" :disabled="busy || loading" :can-save="canWrite" :today="today" @save="save(task, $event)" @failure="showError" @delete="remove(task)" @close="editing = null" />
          </article>
          </TaskListing>
        </section>
        <div class="list-bottom"><span v-if="tasks.length">{{ tasks.length }} {{ tasks.length === 1 ? 'task' : 'tasks' }}{{ cursor ? ' loaded · more available' : '' }}</span><button v-if="cursor" class="secondary" :disabled="busy || loading" @click="run(() => load(true))">{{ loading ? 'Loading…' : 'Load more' }}</button></div>
        <footer><span class="small-dot"></span>{{ session?.mode === 'clerk' ? 'Saved privately in your workspace.' : accountId ? 'Your private workspace.' : 'Local development workspace.' }}<span v-if="lastSynced">Last refreshed {{ new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(lastSynced) }} · {{ TIME_ZONE }}</span></footer>
        </template>
      </div>
    </main>
  </div>
</template>
