<template>
  <Card>
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Plans</h1>
      <RouterLink
        to="/plans/new"
        class="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        <PlusCircle class="h-4 w-4" /> New Plan
      </RouterLink>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="text-left text-gray-500">
          <tr>
            <th class="py-2 pr-4">Title</th>
            <th class="py-2 pr-4">Expected</th>
            <th class="py-2 pr-4">Due</th>
            <th class="py-2 pr-0 text-right">Actions</th>
          </tr>
        </thead>

        <tbody>
          <!-- skeleton loading -->
          <tr v-if="loading" v-for="i in 3" :key="'sk'+i" class="border-t border-gray-100 dark:border-gray-800">
            <td class="py-3 pr-4">
              <div class="h-4 w-48 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"></div>
            </td>
            <td class="py-3 pr-4">
              <div class="h-4 w-20 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"></div>
            </td>
            <td class="py-3 pr-4">
              <div class="h-4 w-40 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"></div>
            </td>
            <td class="py-3 pr-0 text-right">
              <div class="h-8 w-28 ml-auto animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"></div>
            </td>
          </tr>

          <tr
            v-for="p in plans"
            :key="p.id"
            class="border-t border-gray-100 dark:border-gray-800"
          >
            <td class="py-3 pr-4">{{ p.title }}</td>
            <td class="py-3 pr-4">{{ p.expectedMinutes }} min</td>
            <td class="py-3 pr-4">{{ new Date(p.dueAt).toLocaleString() }}</td>
            <td class="py-3 pr-0 text-right">
              <RouterLink
                :to="`/plans/${p.id}/edit`"
                class="mr-3 underline underline-offset-2 hover:opacity-80"
              >Edit</RouterLink>
              <button
                class="text-red-600 hover:underline underline-offset-2"
                @click="askDelete(p)"
              >Delete</button>
            </td>
          </tr>

          <tr v-if="!loading && !plans.length">
            <td colspan="4" class="py-6 text-gray-500">No plans yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Confirm deletion modal -->
    <ConfirmModal
      :open="!!pendingDelete"
      title="Delete plan?"
      @cancel="pendingDelete = null"
      @confirm="doDelete"
    >
      Are you sure you want to delete
      <strong v-if="pendingDelete">"{{ pendingDelete.title }}"</strong> ?
    </ConfirmModal>
  </Card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Card from '../components/ui/Card.vue'
import { PlusCircle } from 'lucide-vue-next'
import { useApi } from '../lib/useApi'
import type { Plan } from '../types'
import { RouterLink } from 'vue-router'
import ConfirmModal from '../components/common/ConfirmModal.vue'

const api = useApi()
const plans = ref<Plan[]>([])
const loading = ref(true)

const pendingDelete = ref<Plan | null>(null)

function askDelete(p: Plan) {
  pendingDelete.value = p
}

async function doDelete() {
  if (!pendingDelete.value) return
  await api.deletePlan(Number(pendingDelete.value.id))
  pendingDelete.value = null
  await load()
}

async function load() {
  loading.value = true
  try {
    // si ton endpoint renvoie { items, nextCursor }, adapte ici
    const r = await api.listPlans()
    plans.value = Array.isArray(r.items) ? r.items : r
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
