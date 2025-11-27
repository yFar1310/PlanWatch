<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { CircleDot, PlusCircle, Sun, Moon, Menu } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{
  dark: boolean
}>()

const emit = defineEmits<{
  (e: 'toggleDark'): void
}>()

const isDark = computed(() => props.dark)
const mobileMenuOpen = ref(false)

function toggleDark() {
  emit('toggleDark')
}

function closeMobile() {
  mobileMenuOpen.value = false
}
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-gray-200/70 dark:border-gray-800
           backdrop-blur supports-[backdrop-filter]:bg-white/70
           dark:supports-[backdrop-filter]:bg-gray-950/60
           bg-white/80 dark:bg-gray-950/70"
  >
    <div class="container-xx h-14 flex items-center gap-3">
      <!-- Brand -->
      <RouterLink
        to="/"
        class="flex items-center gap-2 font-semibold"
        @click="closeMobile"
      >
        <CircleDot class="h-5 w-5 text-brand" />
        <span>PlanWatch</span>
      </RouterLink>

      <!-- Desktop nav -->
      <nav class="ml-6 hidden md:flex items-center gap-1">
        <RouterLink to="/" class="navlink">Dashboard</RouterLink>
        <RouterLink to="/plans" class="navlink">Plans</RouterLink>
        <RouterLink to="/plans/new" class="navlink">New</RouterLink>
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <!-- New plan (desktop only) -->
        <RouterLink
          to="/plans/new"
          class="hidden sm:inline-flex items-center gap-2 rounded-xl border
                 border-gray-200 dark:border-gray-800 px-3 py-2 text-sm
                 hover:bg-gray-50 dark:hover:bg-gray-900"
        >
          <PlusCircle class="h-4 w-4" />
          <span>New Plan</span>
        </RouterLink>

        <!-- Theme toggle -->
        <button
          @click="toggleDark"
          class="rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2
                 hover:bg-gray-50 dark:hover:bg-gray-900"
          aria-label="Toggle dark mode"
        >
          <Moon v-if="!isDark" class="h-4 w-4" />
          <Sun v-else class="h-4 w-4" />
        </button>

        <!-- Avatar -->
        <div class="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500" />

        <!-- Mobile menu toggle -->
        <button
          class="md:hidden ml-1 rounded-xl border border-gray-200 dark:border-gray-800
                 p-2 hover:bg-gray-50 dark:hover:bg-gray-900"
          @click="mobileMenuOpen = !mobileMenuOpen"
          aria-label="Toggle navigation"
        >
          <Menu class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Mobile nav -->
    <nav
      v-if="mobileMenuOpen"
      class="md:hidden border-t border-gray-200/70 dark:border-gray-800
             bg-white/95 dark:bg-gray-950/95"
    >
      <div class="container-xx flex items-center justify-around py-2 text-sm">
        <RouterLink to="/" class="navlink-mobile" @click="closeMobile">
          Dashboard
        </RouterLink>
        <RouterLink to="/plans" class="navlink-mobile" @click="closeMobile">
          Plans
        </RouterLink>
        <RouterLink to="/plans/new" class="navlink-mobile" @click="closeMobile">
          New
        </RouterLink>
      </div>
    </nav>
  </header>
</template>

<style scoped>
.navlink {
  @apply rounded-xl px-3 py-2 text-sm text-gray-600 dark:text-gray-300
         hover:bg-gray-100 dark:hover:bg-gray-900;
}
.router-link-active.navlink {
  @apply bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white;
}

.navlink-mobile {
  @apply px-3 py-1 rounded-full text-xs font-medium
         text-gray-700 dark:text-gray-200
         hover:bg-gray-100 dark:hover:bg-gray-900;
}
.router-link-active.navlink-mobile {
  @apply bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900;
}
</style>
