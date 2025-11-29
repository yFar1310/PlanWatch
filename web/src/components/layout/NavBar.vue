<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { CircleDot, PlusCircle, Sun, Moon, Menu } from 'lucide-vue-next'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import type { User } from '../../types'

const router = useRouter()

// Props & emits
const props = defineProps<{ dark: boolean }>()
const emit = defineEmits<{ (e: 'toggleDark'): void }>()

// UI state
const isDark = computed(() => props.dark)
const mobileMenuOpen = ref(false)
const userMenuOpen = ref(false)
const userMenuEl = ref<HTMLElement | null>(null)

// ---------------------------------------------------------------------------
// User state
// ---------------------------------------------------------------------------
const currentUser = ref<User | null>(null)

function loadUserFromStorage() {
  const raw = localStorage.getItem('pw.user')
  if (!raw) {
    currentUser.value = null
    return
  }
  try {
    currentUser.value = JSON.parse(raw)
  } catch {
    currentUser.value = null
  }
}

const initials = computed(() => {
  if (!currentUser.value?.fullName && !(currentUser.value as any)?.email)
    return 'PW'

  const src = currentUser.value.fullName || (currentUser.value as any).email || ''
  return src
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
})

// ---------------------------------------------------------------------------
// UI interactions
// ---------------------------------------------------------------------------
function toggleDark() {
  emit('toggleDark')
}

function closeMobile() {
  mobileMenuOpen.value = false
}

function closeMenus() {
  mobileMenuOpen.value = false
  userMenuOpen.value = false
}

function logout() {
  userMenuOpen.value = false
  localStorage.removeItem('pw.token')
  localStorage.removeItem('pw.user')
  router.push('/login')
}

function handleClickOutside(e: MouseEvent) {
  if (!userMenuEl.value) return
  if (!userMenuEl.value.contains(e.target as Node)) {
    userMenuOpen.value = false
  }
}

// When profile changes (localStorage event from another tab or after save)
function handleStorage(e: StorageEvent) {
  if (e.key === 'pw.user') {
    loadUserFromStorage()
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
onMounted(() => {
  loadUserFromStorage()
  window.addEventListener('click', handleClickOutside)
  window.addEventListener('storage', handleStorage)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleClickOutside)
  window.removeEventListener('storage', handleStorage)
})
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
        @click="closeMenus"
      >
        <CircleDot class="h-5 w-5 text-brand" />
        <span>PlanWatch</span>
      </RouterLink>

      <!-- Desktop nav -->
      <nav class="ml-6 hidden md:flex items-center gap-1">
        <RouterLink to="/" class="navlink" @click="closeMenus">Dashboard</RouterLink>
        <RouterLink to="/plans" class="navlink" @click="closeMenus">Plans</RouterLink>
        <RouterLink to="/plans/new" class="navlink" @click="closeMenus">New</RouterLink>
      </nav>

      <!-- Right side -->
      <div class="ml-auto flex items-center gap-2">
        <!-- New plan (desktop only) -->
        <RouterLink
          to="/plans/new"
          class="hidden sm:inline-flex items-center gap-2 rounded-xl border
                 border-gray-200 dark:border-gray-800 px-3 py-2 text-sm
                 hover:bg-gray-50 dark:hover:bg-gray-900"
          @click="closeMenus"
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

        <!-- Avatar + menu -->
        <div class="relative" ref="userMenuEl">
          <button
            type="button"
            class="h-8 w-8 rounded-full border border-gray-200 dark:border-gray-700
                   flex items-center justify-center overflow-hidden
                   bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-[11px]
                   font-semibold shadow-sm"
            @click.stop="userMenuOpen = !userMenuOpen"
          >
            <img
              v-if="currentUser?.avatarData"
              :src="currentUser.avatarData"
              alt="Avatar"
              class="h-full w-full object-cover"
            />
            <span v-else>{{ initials }}</span>
          </button>

          <!-- Dropdown -->
          <div
            v-if="userMenuOpen"
            class="absolute right-0 mt-2 w-48 rounded-xl border border-gray-200/80 bg-white shadow-lg
                   dark:border-gray-800/80 dark:bg-gray-900 z-50 overflow-hidden text-xs"
          >
            <div class="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
              <div class="font-semibold text-gray-800 dark:text-gray-100 truncate">
                {{ currentUser?.fullName || 'Signed in' }}
              </div>
              <div class="text-[10px] truncate text-gray-500 dark:text-gray-400">
                {{ (currentUser as any)?.email }}
              </div>
            </div>

            <button
              type="button"
              class="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50
                     dark:text-gray-200 dark:hover:bg-gray-800 text-xs"
              @click="
                userMenuOpen = false;
                router.push('/profile');
              "
            >
              Profile
            </button>

            <button
              type="button"
              @click="logout"
              class="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50
                     dark:text-gray-200 dark:hover:bg-gray-800 text-xs border-t
                     border-gray-100 dark:border-gray-800"
            >
              Logout
            </button>
          </div>
        </div>

        <!-- Mobile menu toggle -->
        <button
          class="md:hidden ml-1 rounded-xl border border-gray-200 dark:border-gray-800
                 p-2 hover:bg-gray-50 dark:hover:bg-gray-900"
          @click.stop="mobileMenuOpen = !mobileMenuOpen"
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
        <RouterLink to="/" class="navlink-mobile" @click="closeMenus">
          Dashboard
        </RouterLink>
        <RouterLink to="/plans" class="navlink-mobile" @click="closeMenus">
          Plans
        </RouterLink>
        <RouterLink to="/plans/new" class="navlink-mobile" @click="closeMenus">
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
