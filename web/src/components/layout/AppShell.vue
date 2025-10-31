<template>
<div class="min-h-screen flex flex-col">
<Navbar @toggleDark="toggleDark" />
<main class="flex-1 container-xx py-8">
<slot />
</main>
<footer class="border-t border-gray-200/70 dark:border-gray-800 py-6 text-sm text-gray-500">
<div class="container-xx flex items-center justify-between">
<p>© {{ new Date().getFullYear() }} PlanWatch</p>
<p class="hidden sm:block">Built with Vue 3 + Tailwind</p>
</div>
</footer>
</div>
</template>
<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import Navbar from './NavBar.vue'


const dark = ref<boolean>(localStorage.getItem('pw.dark') === '1')
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