<script setup lang="ts">
import { Timer, Calendar } from 'lucide-vue-next'
</script>

<template>
  <div class="space-y-6">
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <section class="card">
        <div class="card-body">
          <div class="flex items-center gap-3">
            <Timer class="h-5 w-5 text-brand" />
            <h2 class="font-semibold">Today</h2>
          </div>
          <p class="mt-4 text-sm text-gray-600 dark:text-gray-400">Quick overview of your planned vs actual minutes.</p>
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <div class="flex items-center gap-3">
            <Calendar class="h-5 w-5 text-brand" />
            <h2 class="font-semibold">Upcoming</h2>
          </div>
          <p class="mt-4 text-sm text-gray-600 dark:text-gray-400">Due soon plans at a glance.</p>
        </div>
      </section>
    </div>
  </div>
</template>

