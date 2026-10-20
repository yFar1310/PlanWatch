<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from './api';
import { MailPlus, RefreshCw, Trash2, Users, Activity, ListTodo, Clock3 } from '@lucide/vue';
import ConfirmDialog from './ConfirmDialog.vue';
import type { AdminDashboard, Invitation, Member } from '../shared/admin';
const emit = defineEmits<{ failure: [problem: unknown] }>();
const data = ref<AdminDashboard | null>(null);
const search = ref(''), status = ref('all'), label = ref(''), link = ref('');
const loading = ref(false), busy = ref(false), error = ref(''), message = ref('');
const confirming = ref<string | null>(null);
const invitationAction = ref<{invitation:Invitation;action:'revoke'|'delete'}|null>(null);
const linkId = ref('');
let disposed = false;
function fail(problem: unknown) { if (disposed) return; error.value = problem instanceof Error ? problem.message : 'Please try again.'; emit('failure', problem); }
async function load(append = false) {
  if (loading.value || disposed) return;
  loading.value = true; error.value = '';
  const query = new URLSearchParams({ q: search.value.trim(), status: status.value });
  if (append && data.value?.nextCursor) query.set('cursor', data.value.nextCursor);
  try {
    const result = await api<AdminDashboard>(`/admin?${query}`);
    if (!disposed) data.value = append && data.value ? { ...result, members: [...data.value.members, ...result.members] } : result;
  } catch (problem) { fail(problem); } finally { loading.value = false; }
}
async function action(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try { await work(); if (!disposed) await load(); } catch (problem) { fail(problem); } finally { busy.value = false; }
}
function create() { return action(async () => {
  const result = await api<{ link: string; invitation?:Invitation }>('/admin/invitations', 'POST', { label: label.value.trim() });
  if (!disposed) { link.value = result.link; linkId.value=result.invitation?.id||''; label.value = ''; message.value = 'Invitation created. Copy the link before leaving this page.'; }
}); }
function confirmInvitation() { const pending=invitationAction.value;if(!pending)return;return action(async()=>{
  const {invitation,action:operation}=pending;
  await api(`/admin/invitations/${invitation.id}${operation==='delete'?'/delete':''}`,operation==='delete'?'POST':'DELETE',operation==='delete'?{confirmed:true}:{});
  if(disposed)return;
  if(linkId.value===invitation.id){link.value='';linkId.value='';}
  invitationAction.value=null;message.value=operation==='delete'?'Invitation deleted. Existing member access is unchanged.':'Invitation revoked. This link can no longer be used.';
}); }
function change(member: Member) { return action(async () => {
  await api(`/admin/users/${member.id}`, 'PATCH', { version: member.version, status: member.status === 'banned' ? 'active' : 'banned' });
  confirming.value = null; message.value = member.status === 'banned' ? 'Access restored.' : 'Member banned. Their saved tasks are preserved.';
}); }
async function copy() {
  try { await navigator.clipboard.writeText(link.value); message.value = 'Invitation link copied.'; }
  catch { message.value = 'Select the link below and copy it manually.'; }
}
function duration(ms: number) { const minutes = Math.floor(ms / 60000); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`; }
function date(value: number | null) { return value === null ? 'Not recorded yet' : new Date(value).toLocaleString(); }
onMounted(() => { void load(); });
onUnmounted(() => { disposed = true; link.value = ''; });
</script>

<template>
  <section class="admin-panel" aria-labelledby="admin-title">
    <div class="heading-row"><div><p class="eyebrow">YOUR APPLICATION</p><h1 id="admin-title">Administration</h1><p class="intro">Invite people, manage access and follow overall usage.</p></div><button class="secondary" :disabled="loading || busy" @click="load()"><RefreshCw :size="16" :class="{spin:loading}" />Refresh</button></div>
    <p v-if="error&&!invitationAction" class="error-message" role="alert">{{ error }}</p><p v-if="message" class="admin-feedback" role="status">{{ message }}</p>
    <p v-if="loading && !data" role="status">Loading administration…</p>
    <div v-if="data" class="admin-stats">
      <article><div class="admin-stat-label"><Users :size="17" /><span>Members</span></div><strong>{{ data.totals.members }}</strong><span>{{ data.totals.banned }} banned</span></article>
      <article><div class="admin-stat-label"><Activity :size="17" /><span>Recently seen</span></div><strong>{{ data.totals.recentlySeen }}</strong><span>In the last 15 minutes</span></article>
      <article><div class="admin-stat-label"><Clock3 :size="17" /><span>Active time</span></div><strong>{{ duration(data.totals.activeMs) }}</strong><span>Estimated · all time</span></article>
      <article><div class="admin-stat-label"><ListTodo :size="17" /><span>Tasks</span></div><strong>{{ data.totals.tasks }}</strong><span>All workspaces · includes Trash</span></article>
    </div>
    <section class="admin-card" aria-labelledby="invite-title">
      <header class="admin-section-heading"><div><h2 id="invite-title">Invitations</h2><p>One person per link · valid for 7 days · links shown once.</p></div><MailPlus :size="22" aria-hidden="true" /></header>
      <form class="admin-form invite-form" @submit.prevent="create"><label>Invitation label<input v-model="label" required maxlength="80" placeholder="For example: Alex" :disabled="busy||loading" /></label><button class="primary" :disabled="busy || loading || !label.trim()" type="submit"><MailPlus :size="16" />Create invitation</button></form>
      <div v-if="link" class="invite-result"><label>New invitation link<input :value="link" readonly @focus="($event.target as HTMLInputElement).select()" /></label><button class="secondary" @click="copy">Copy link</button></div>
      <ul v-if="data?.invitations.length" class="admin-invites"><li v-for="invitation in data.invitations" :key="invitation.id"><div class="invite-description"><strong>{{ invitation.label }}</strong><span>Expires {{ date(invitation.expiresAt) }}</span></div><span class="access-badge" :data-status="invitation.status">{{ invitation.status }}</span><div class="invite-actions"><button v-if="invitation.status === 'active'" class="secondary" :disabled="busy||loading" @click="error='';invitationAction={invitation,action:'revoke'}">Revoke</button><button :title="`Delete invitation ${invitation.label}`" class="icon-button danger-button" :aria-label="`Delete invitation ${invitation.label}`" :disabled="busy||loading" @click="error='';invitationAction={invitation,action:'delete'}"><Trash2 :size="17" /></button></div></li></ul>
      <p v-else-if="data">No invitations yet.</p>
    </section>
    <section class="admin-card" aria-labelledby="members-title">
      <header class="admin-section-heading"><div><h2 id="members-title">Members</h2><p>Manage access to each private workspace.</p></div><Users :size="22" aria-hidden="true" /></header>
      <form class="admin-form member-search" @submit.prevent="load()"><label>Find a member<input v-model="search" :disabled="busy||loading" type="search" maxlength="80" placeholder="Display name" /></label><label>Access<select v-model="status" :disabled="busy||loading"><option value="all">Everyone</option><option value="active">Active</option><option value="banned">Banned</option></select></label><button class="secondary" :disabled="busy || loading">Search</button></form>
      <div v-if="data" class="admin-members" :aria-busy="loading || busy">
        <article v-for="member in data.members" :key="member.id" class="member-card">
          <div class="member-heading"><div class="member-identity"><h3>{{ member.displayName }} <span v-if="member.isAdmin" class="member-badge">You · Administrator</span></h3><p><span class="access-badge" :data-status="member.status">{{ member.status }}</span> Joined {{ date(member.createdAt) }}</p><code class="member-reference">{{ member.id }}</code></div><button v-if="!member.isAdmin && confirming !== member.id" class="secondary" :disabled="busy || loading" @click="member.status === 'banned' ? change(member) : confirming = member.id">{{ member.status === 'banned' ? 'Restore access' : 'Ban member' }}</button></div>
          <dl class="member-metrics"><div><dt>Last seen</dt><dd>{{ date(member.lastSeenAt) }}</dd></div><div><dt>Sessions</dt><dd>{{ member.sessions }}</dd></div><div><dt>Estimated active time</dt><dd>{{ duration(member.activeMs) }}</dd></div><div><dt>Tasks / completed</dt><dd>{{ member.tasks }} / {{ member.completedTasks }}</dd></div></dl>
          <div v-if="confirming === member.id" class="ban-confirm"><p>Ban {{ member.displayName }}? Access will stop on their next request. Their tasks will be kept.</p><button class="danger-button" :disabled="busy" @click="change(member)">Confirm ban</button><button class="secondary" :disabled="busy" @click="confirming = null">Cancel</button></div>
        </article>
        <p v-if="!data.members.length">No members match this search.</p>
        <button v-if="data.nextCursor" class="secondary" :disabled="loading || busy" @click="load(true)">Load more members</button>
      </div>
    </section>
    <p class="admin-note">Activity estimates time spent active in a visible tab. Sessions count observed sign-ins. Task titles and notes stay private.</p>
    <ConfirmDialog v-if="invitationAction" :title="`${invitationAction.action==='delete'?'Delete':'Revoke'} invitation?`" :description="invitationAction.action==='delete'?`Remove “${invitationAction.invitation.label}” from this list and invalidate its link? If already used, the member’s account and tasks will be kept.`:`Invalidate the link for “${invitationAction.invitation.label}”? You can create a new invitation later.`" :confirm-label="invitationAction.action==='delete'?'Delete invitation':'Revoke invitation'" cancel-label="Cancel" :danger="true" :busy="busy" :error="error" @confirm="confirmInvitation" @cancel="invitationAction=null" />
  </section>
</template>
