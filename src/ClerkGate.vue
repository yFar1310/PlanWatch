<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { SignIn, useAuth, useClerk, useUser } from '@clerk/vue';
import { Check, LoaderCircle, Moon, Sun } from '@lucide/vue';
import App from './App.vue';
import { setAuthTokenProvider } from './api';
import { deactivateDrafts } from './drafts';
import { useTheme } from './theme';
import { pendingInvitation } from './invitations';

const { isLoaded, isSignedIn, userId, sessionId, getToken } = useAuth();
const clerk = useClerk();
const { user } = useUser();
const profileName = computed(() => [user.value?.fullName,user.value?.firstName,user.value?.username].map(name=>name?.trim()).find(Boolean)?.slice(0,80) || '');
const { isDark, toggle: toggleTheme } = useTheme();
const slow = ref(false);
const signingOut = ref(false);
const signOutError = ref('');
const appearance = computed(() => ({ variables: {
  colorPrimary: isDark.value ? '#bea5ef' : '#7052b4',
  colorBackground: isDark.value ? '#1b1d29' : '#ffffff',
  colorForeground: isDark.value ? '#eeeaf6' : '#2d2938',
  colorMutedForeground: isDark.value ? '#b2abc2' : '#706879',
  colorInput: isDark.value ? '#12141c' : '#ffffff',
  colorInputForeground: isDark.value ? '#eeeaf6' : '#2d2938',
  colorBorder: isDark.value ? '#393647' : '#ddd9e7',
  borderRadius: '0.75rem', fontFamily: 'inherit',
} }));
let loadTimer: ReturnType<typeof setTimeout> | undefined;

// Register before mounting App. A user/session change invalidates any in-flight API result.
watch([isSignedIn, userId, sessionId], () => {
  deactivateDrafts();
  setAuthTokenProvider(async () => isSignedIn.value ? await getToken.value() : null);
}, { immediate: true, flush: 'sync' });

async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  deactivateDrafts();
  signOutError.value = '';
  setAuthTokenProvider(async () => null);
  try { await clerk.value?.signOut({ redirectUrl: '/' }); }
  catch {
    signOutError.value = 'Sign-out could not be confirmed. Reconnect and try again.';
    // Keep private content hidden until sign-out succeeds or the page is explicitly reloaded.
  }
}
function reloadPage() { window.location.reload(); }
onMounted(() => { loadTimer = setTimeout(() => { slow.value = true; }, 15_000); });
onUnmounted(() => { clearTimeout(loadTimer); setAuthTokenProvider(async () => null); });
</script>

<template>
  <App v-if="isLoaded && isSignedIn && !signingOut" :key="`${userId}:${sessionId}`" :account-id="userId ?? undefined" :profile-name="profileName" @sign-out="signOut" @sign-in="signOut" />
  <main v-else class="auth-page">
    <button :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'" class="theme-toggle auth-theme" type="button" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleTheme"><component :is="isDark ? Sun : Moon" :size="20" /></button>
    <section class="auth-card" aria-labelledby="signin-heading">
      <div class="auth-brand"><span class="brand-icon"><Check :size="22" :stroke-width="3" /></span><span>PlanWatch</span><span class="version">2.0</span></div>
      <p class="eyebrow">A LITTLE MORE ROOM TO FOCUS</p>
      <h1 id="signin-heading">{{ pendingInvitation ? 'You’re invited to PlanWatch.' : 'Your day. Your space.' }}</h1>
      <p>{{ pendingInvitation ? 'Sign in to continue. Your invitation will be kept for the next step.' : 'Sign in to find your tasks, wherever you are.' }}</p>
      <template v-if="!isLoaded">
        <div class="auth-loading" role="status"><LoaderCircle class="spin" :size="22" />Preparing secure sign-in…</div>
        <p v-if="slow">Sign-in is taking longer than expected. Check your connection and try reloading.</p>
        <button v-if="slow" class="secondary" @click="reloadPage">Reload sign-in</button>
      </template>
      <template v-else-if="signingOut">
        <p role="status">{{ signOutError || 'Signing out… Your drafts are kept on this device.' }}</p>
        <button v-if="signOutError" class="secondary" @click="signingOut = false; signOut()">Try signing out again</button>
      </template>
      <SignIn v-else routing="hash" :force-redirect-url="'/'" :sign-up-force-redirect-url="'/'" :appearance="appearance" />
      <p class="auth-note">Private workspaces. Access by invitation.</p>
    </section>
  </main>
</template>
