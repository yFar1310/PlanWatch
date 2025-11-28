<template>
  <div
    class="relative min-h-screen flex flex-col text-slate-900 dark:text-slate-50"
  >
    <AppBackground />

    <!-- navigation bar -->
    <Transition name="fade">
      <div
        v-if="isNavigating"
        class="fixed inset-x-0 top-0 z-50 h-0.5 bg-gradient-to-r
               from-violet-500 via-sky-400 to-emerald-400 animate-pulse"
      />
    </Transition>

    <!-- header hidden on /login -->
    <Navbar
      v-if="showHeader"
      class="relative z-10"
      :dark="dark"
      @toggleDark="toggleDark"
    />

    <!-- page content -->
    <main class="relative z-10 flex-1 container-xx py-8">
      <RouterView v-slot="{ Component, route }">
        <Transition name="page-fade" mode="out-in" appear>
          <component :is="Component" :key="route.fullPath" />
        </Transition>
      </RouterView>
    </main>

    <footer
      v-if="showHeader"
      class="relative z-10 border-t border-gray-200/70 dark:border-gray-800
             py-6 text-sm text-gray-500"
    >
      <div class="container-xx flex items-center justify-between">
        <p>© {{ new Date().getFullYear() }} PlanWatch</p>
        <p class="hidden sm:block">Built with Vue 3 + Tailwind</p>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, watchEffect, inject, computed, type Ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import Navbar from './NavBar.vue'
import AppBackground from './AppBackground.vue'

const route = useRoute()
const dark = ref(localStorage.getItem('pw.dark') === '1')
const isNavigating = inject<Ref<boolean>>('isNavigating', ref(false))

const showHeader = computed(() => route.name !== 'login')

function toggleDark() {
  dark.value = !dark.value
}

watchEffect(() => {
  const root = document.documentElement
  if (dark.value) {
    root.classList.add('dark')
    localStorage.setItem('pw.dark', '1')
  } else {
    root.classList.remove('dark')
    localStorage.removeItem('pw.dark')
  }
})
</script>
