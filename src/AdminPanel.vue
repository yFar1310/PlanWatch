<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from './api';
import type { AdminDashboard, Member } from '../shared/admin';
const emit = defineEmits<{ failure: [problem: unknown] }>();
const data = ref<AdminDashboard | null>(null);
const search = ref(''), status = ref('all'), label = ref(''), link = ref('');
const loading = ref(false), busy = ref(false), error = ref(''), message = ref('');
const confirming = ref<string | null>(null);
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
  const result = await api<{ link: string }>('/admin/invitations', 'POST', { label: label.value.trim() });
  if (!disposed) { link.value = result.link; label.value = ''; message.value = 'Invitation created. Copy the link before leaving this page.'; }
}); }
function revoke(id: string) { return action(async () => { await api(`/admin/invitations/${id}`, 'DELETE', {}); message.value = 'Invitation revoked.'; }); }
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
    <div class="heading-row"><div><p class="eyebrow">YOUR APPLICATION</p><h1 id="admin-title">Administration</h1><p class="intro">Invite people, manage access and follow overall usage.</p></div><button class="secondary" :disabled="loading || busy" @click="load()">Refresh</button></div>
    <p class="capture-hint">Activity is an estimate of time spent active in a visible tab. Sessions are observed sign-in sessions, not a count of page visits. Task titles and notes stay in each private workspace. Counters include Trash.</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p><p role="status">{{ message }}</p>
    <p v-if="loading && !data" role="status">Loading administration…</p>
    <div v-if="data" class="admin-stats">
      <article><strong>{{ data.totals.members }}</strong><span>Members · {{ data.totals.banned }} banned</span></article>
      <article><strong>{{ data.totals.recentlySeen }}</strong><span>Seen in the last 15 minutes</span></article>
      <article><strong>{{ duration(data.totals.activeMs) }}</strong><span>Estimated active time · all time</span></article>
      <article><strong>{{ data.totals.tasks }}</strong><span>Tasks · all workspaces</span></article>
    </div>
    <section class="admin-card" aria-labelledby="invite-title">
      <h2 id="invite-title">Invitations</h2><p>One person per link. Valid for 7 days. Share only with the intended person. Links are shown once; revoke a lost link and create another.</p>
      <form class="admin-form" @submit.prevent="create"><label>Invitation label<input v-model="label" required maxlength="80" placeholder="For example: Alex" :disabled="busy" /></label><button class="primary" :disabled="busy || !label.trim()" type="submit">Create invitation</button></form>
      <div v-if="link" class="invite-result"><label>New invitation link<input :value="link" readonly @focus="($event.target as HTMLInputElement).select()" /></label><button class="secondary" @click="copy">Copy link</button></div>
      <ul v-if="data?.invitations.length" class="admin-invites"><li v-for="invitation in data.invitations" :key="invitation.id"><div><strong>{{ invitation.label }}</strong><span>{{ invitation.status }} · Expires {{ date(invitation.expiresAt) }}</span></div><button v-if="invitation.status === 'active'" class="secondary" :disabled="busy" @click="revoke(invitation.id)">Revoke</button></li></ul>
      <p v-else-if="data">No invitations yet.</p>
    </section>
    <section class="admin-card" aria-labelledby="members-title">
      <h2 id="members-title">Members</h2>
      <form class="admin-form" @submit.prevent="load()"><label>Find a member<input v-model="search" type="search" maxlength="80" placeholder="Display name" /></label><label>Access<select v-model="status"><option value="all">Everyone</option><option value="active">Active</option><option value="banned">Banned</option></select></label><button class="secondary" :disabled="busy || loading">Search</button></form>
      <div v-if="data" class="admin-members" :aria-busy="loading || busy">
        <article v-for="member in data.members" :key="member.id" class="member-card">
          <div class="member-heading"><div><h3>{{ member.displayName }} <span v-if="member.isAdmin" class="member-badge">You · Administrator</span></h3><p>{{ member.status }} · Joined {{ date(member.createdAt) }}</p><code class="member-reference">{{ member.id }}</code></div><button v-if="!member.isAdmin && confirming !== member.id" class="secondary" :disabled="busy || loading" @click="member.status === 'banned' ? change(member) : confirming = member.id">{{ member.status === 'banned' ? 'Restore access' : 'Ban member' }}</button></div>
          <dl class="member-metrics"><div><dt>Last seen</dt><dd>{{ date(member.lastSeenAt) }}</dd></div><div><dt>Sessions</dt><dd>{{ member.sessions }}</dd></div><div><dt>Estimated active time</dt><dd>{{ duration(member.activeMs) }}</dd></div><div><dt>Tasks / completed</dt><dd>{{ member.tasks }} / {{ member.completedTasks }}</dd></div></dl>
          <div v-if="confirming === member.id" class="ban-confirm"><p>Ban {{ member.displayName }}? Access will stop on their next request. Their tasks will be kept.</p><button class="danger-button" :disabled="busy" @click="change(member)">Confirm ban</button><button class="secondary" :disabled="busy" @click="confirming = null">Cancel</button></div>
        </article>
        <p v-if="!data.members.length">No members match this search.</p>
        <button v-if="data.nextCursor" class="secondary" :disabled="loading || busy" @click="load(true)">Load more members</button>
      </div>
    </section>
  </section>
</template>
