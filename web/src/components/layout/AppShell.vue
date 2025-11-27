<template>
  <div
    class="relative min-h-screen flex flex-col
           text-slate-900 dark:text-slate-50"
  >
    <AppBackground />

    <!-- Loading bar (navigation) -->
    <Transition name="fade">
      <div
        v-if="isNavigating"
        class="fixed inset-x-0 top-0 z-50 h-0.5
               bg-gradient-to-r from-violet-500 via-sky-400 to-emerald-400
               animate-pulse"
      />
    </Transition>

    <Navbar
      class="relative z-10"
      :dark="dark"
      @toggleDark="toggleDark"
    />

    <main class="relative z-10 flex-1 container-xx py-8">
      <RouterView v-slot="{ Component, route }">
        <Transition name="page-fade" mode="out-in" appear>
          <component :is="Component" :key="route.fullPath" />
        </Transition>
      </RouterView>
    </main>

    <footer
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
import { ref, watchEffect, inject, type Ref } from 'vue'
import { RouterView } from 'vue-router'
import Navbar from './NavBar.vue'
import AppBackground from './AppBackground.vue'

const dark = ref(localStorage.getItem('pw.dark') === '1')

// récupère le flag de navigation fourni dans main.ts
const isNavigating = inject<Ref<boolean>>('isNavigating', ref(false))

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
