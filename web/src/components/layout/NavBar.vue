<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { CircleDot, PlusCircle, Sun, Moon } from 'lucide-vue-next'
import { computed } from 'vue'
const isDark = computed(() => document.documentElement.classList.contains('dark'))
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-gray-200/70 dark:border-gray-800 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-gray-950/60">
    <div class="container-xx h-14 flex items-center gap-3">
      <RouterLink to="/" class="flex items-center gap-2 font-semibold">
        <CircleDot class="h-5 w-5 text-brand" />
        <span>PlanWatch</span>
      </RouterLink>

      <nav class="ml-6 hidden md:flex items-center gap-1">
        <RouterLink to="/" class="navlink">Dashboard</RouterLink>
        <RouterLink to="/plans" class="navlink">Plans</RouterLink>
        <RouterLink to="/plans/new" class="navlink">New</RouterLink>
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <RouterLink to="/plans/new" class="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900">
          <PlusCircle class="h-4 w-4" />
          <span class="hidden sm:inline">New Plan</span>
        </RouterLink>

        <button @click="$emit('toggleDark')" class="rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900" aria-label="Toggle dark mode">
          <Sun v-if="isDark" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
        </button>

        <div class="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.navlink { @apply rounded-xl px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-900; }
.router-link-active.navlink { @apply bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white; }
</style>
