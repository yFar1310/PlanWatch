<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { CircleDot, PlusCircle, Sun, Moon, Menu } from 'lucide-vue-next'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

const router = useRouter()
const props = defineProps<{ dark: boolean }>()
const emit = defineEmits<{ (e: 'toggleDark'): void }>()

const isDark = computed(() => props.dark)
const mobileMenuOpen = ref(false)
const userMenuOpen = ref(false)
const userMenuEl = ref<HTMLElement | null>(null)

function toggleDark() {
  emit('toggleDark')
}
function closeMenus() {
  mobileMenuOpen.value = false
  userMenuOpen.value = false
}
function logout() {
  localStorage.removeItem('pw.token')
  localStorage.removeItem('pw.user.email')
  router.push('/login')
}
function handleClickOutside(e: MouseEvent) {
  if (userMenuEl.value && !userMenuEl.value.contains(e.target as Node))
    userMenuOpen.value = false
}
onMounted(() => window.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => window.removeEventListener('click', handleClickOutside))
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
      <RouterLink to="/" class="flex items-center gap-2 font-semibold" @click="closeMenus">
        <CircleDot class="h-5 w-5 text-brand" />
        <span>PlanWatch</span>
      </RouterLink>

      <!-- Desktop nav -->
      <nav class="ml-6 hidden md:flex items-center gap-1">
        <RouterLink to="/" class="navlink" @click="closeMenus">Dashboard</RouterLink>
        <RouterLink to="/plans" class="navlink" @click="closeMenus">Plans</RouterLink>
        <RouterLink to="/plans/new" class="navlink" @click="closeMenus">New</RouterLink>
      </nav>

      <div class="ml-auto flex items-center gap-2">
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

        <button
          @click="toggleDark"
          class="rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2
                 hover:bg-gray-50 dark:hover:bg-gray-900"
          aria-label="Toggle dark mode"
        >
          <Moon v-if="!isDark" class="h-4 w-4" />
          <Sun v-else class="h-4 w-4" />
        </button>

        <!-- Avatar dropdown -->
        <div class="relative" ref="userMenuEl">
          <button
            type="button"
            class="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500
                   flex items-center justify-center text-[11px] font-semibold text-white shadow-sm"
            @click.stop="userMenuOpen = !userMenuOpen"
          >
            PW
          </button>

          <div
            v-if="userMenuOpen"
            class="absolute right-0 mt-2 w-40 rounded-xl border border-gray-200/80 bg-white shadow-lg
                   dark:border-gray-800/80 dark:bg-gray-900 z-50 overflow-hidden text-xs"
          >
            <div class="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">Signed in</div>
            <button
              type="button"
              @click="logout"
              class="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50
                     dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Logout
            </button>
          </div>
        </div>

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

    <nav
      v-if="mobileMenuOpen"
      class="md:hidden border-t border-gray-200/70 dark:border-gray-800
             bg-white/95 dark:bg-gray-950/95"
    >
      <div class="container-xx flex items-center justify-around py-2 text-sm">
        <RouterLink to="/" class="navlink-mobile" @click="closeMenus">Dashboard</RouterLink>
        <RouterLink to="/plans" class="navlink-mobile" @click="closeMenus">Plans</RouterLink>
        <RouterLink to="/plans/new" class="navlink-mobile" @click="closeMenus">New</RouterLink>
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
  @apply px-3 py-1 rounded-full text-xs font-medium text-gray-700 dark:text-gray-200
         hover:bg-gray-100 dark:hover:bg-gray-900;
}
.router-link-active.navlink-mobile {
  @apply bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900;
}
</style>
