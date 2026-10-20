<script setup lang="ts">
import App from './App.vue';
import ClerkGate from './ClerkGate.vue';
import { clerkEnabled, localPreview } from './auth-config';
</script>

<template>
  <ClerkGate v-if="clerkEnabled" />
  <App v-else-if="localPreview" />
  <main v-else class="auth-page"><section class="auth-card" aria-labelledby="setup-heading"><p class="eyebrow">PLANWATCH</p><h1 id="setup-heading">Your private space is on its way.</h1><p>Sign-in is being prepared. Please come back shortly.</p><p>Your saved tasks remain protected.</p></section></main>
</template>
