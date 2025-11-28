<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../lib/useApi'

const api = useApi()
const route = useRoute()
const router = useRouter()

const email = ref('demo@planwatch.test')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

async function onSubmit() {
  loading.value = true
  error.value = null
  try {
    const res = await api.login(email.value, password.value)
    localStorage.setItem('pw.token', res.token)
    localStorage.setItem('pw.user.email', res.user.email)
    router.push((route.query.redirect as string) || '/')
  } catch (e: any) {
    error.value = e?.message ?? 'Invalid credentials'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-[calc(100vh)] flex items-center justify-center">
    <div
      class="w-full max-w-md rounded-2xl border border-slate-200/70 bg-white/90 p-8
             dark:border-slate-800/80 dark:bg-slate-900/90 shadow-xl"
    >
      <h1 class="text-xl font-semibold text-slate-900 dark:text-slate-50 mb-2">PlanWatch</h1>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">Sign in to your workspace</p>

      <form @submit.prevent="onSubmit" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Email
          </label>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                   bg-white focus:outline-none focus:ring-2 focus:ring-violet-500
                   dark:bg-slate-950 dark:border-slate-700 dark:text-slate-50"
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Password
          </label>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                   bg-white focus:outline-none focus:ring-2 focus:ring-violet-500
                   dark:bg-slate-950 dark:border-slate-700 dark:text-slate-50"
          />
        </div>

        <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full flex items-center justify-center rounded-lg bg-violet-600 text-white text-sm
                 py-2.5 font-medium hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed
                 transition"
        >
          <span v-if="!loading">Sign in</span>
          <span v-else>Signing in…</span>
        </button>
      </form>
    </div>
  </div>
</template>
