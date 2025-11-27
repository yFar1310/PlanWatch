<template>
  <Card>
    <div class="mb-6 flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Plans</h1>
      <RouterLink
        to="/plans/new"
        class="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        <PlusCircle class="h-4 w-4" /> New Plan
      </RouterLink>
    </div>

    <!-- Desktop table -->
    <div class="hidden md:block overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="text-left text-gray-500 dark:text-gray-400">
          <tr>
            <th class="py-2 pr-4">Title</th>
            <th class="py-2 pr-4">Expected</th>
            <th class="py-2 pr-4">Due</th>
            <th class="py-2 pr-4">Dependency</th>
            <th class="py-2 pr-0 text-right">Actions</th>
          </tr>
        </thead>

        <tbody>
          <!-- skeleton -->
          <tr
            v-if="loading"
            v-for="i in 3"
            :key="'sk' + i"
            class="border-t border-gray-100 dark:border-gray-800"
          >
            <td class="py-3 pr-4">
              <div
                class="h-4 w-48 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"
              ></div>
            </td>
            <td class="py-3 pr-4">
              <div
                class="h-4 w-20 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"
              ></div>
            </td>
            <td class="py-3 pr-4">
              <div
                class="h-4 w-40 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"
              ></div>
            </td>
            <td class="py-3 pr-4">
              <div
                class="h-4 w-32 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"
              ></div>
            </td>
            <td class="py-3 pr-0 text-right">
              <div
                class="h-8 w-16 ml-auto animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"
              ></div>
            </td>
          </tr>

          <tr
            v-for="p in plans"
            :key="p.id"
            class="border-t border-gray-100 dark:border-gray-800"
          >
            <td class="py-3 pr-4">{{ p.title }}</td>
            <td class="py-3 pr-4">{{ p.expectedMinutes }} min</td>
            <td class="py-3 pr-4">
              {{ new Date(p.dueAt).toLocaleString() }}
            </td>
            <td class="py-3 pr-4">
              <template v-if="getDependency(p)">
                <div
                  class="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300"
                >
                  <span>After</span>
                  <span class="font-semibold">
                    {{ getDependency(p)?.title }}
                  </span>
                </div>
                <span
                  v-if="isDependencyInconsistent(p)"
                  class="ml-2 text-xs text-amber-400"
                >
                  ⚠ invalid order
                </span>
              </template>
              <span v-else class="text-xs text-gray-500">None</span>
            </td>
            <td class="py-3 pr-0 text-right">
              <div class="inline-flex items-center gap-2">
                <RouterLink
                  :to="`/plans/${p.id}/edit`"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300/70 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label="Edit"
                >
                  <PenSquare class="h-4 w-4" />
                </RouterLink>
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-300/60 text-red-600 dark:border-red-800/70 dark:text-red-400 hover:bg-red-50/70 dark:hover:bg-red-900/40"
                  aria-label="Delete"
                  @click="askDelete(p)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>

          <tr v-if="!loading && !plans.length">
            <td
              colspan="5"
              class="py-6 text-center text-gray-500 dark:text-gray-400"
            >
              No plans yet.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <div class="space-y-3 md:hidden">
      <div
        v-if="loading"
        v-for="i in 3"
        :key="'skm' + i"
        class="rounded-2xl border border-gray-200/70 dark:border-gray-800 bg-white/80 dark:bg-slate-950/80 p-4 space-y-3"
      >
        <div class="h-4 w-40 animate-pulse rounded bg-gray-200/70 dark:bg-gray-800" />
        <div class="h-4 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-800" />
        <div class="h-8 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-800" />
      </div>

      <article
        v-for="p in plans"
        :key="p.id"
        class="rounded-2xl border border-gray-200/70 dark:border-gray-800 bg-white/80 dark:bg-slate-950/80 p-4 space-y-2"
      >
        <header class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-medium text-sm text-gray-900 dark:text-gray-100">
              {{ p.title }}
            </h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Due {{ new Date(p.dueAt).toLocaleString() }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <RouterLink
              :to="`/plans/${p.id}/edit`"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300/70 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <PenSquare class="h-4 w-4" />
            </RouterLink>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-300/60 text-red-600 dark:border-red-800/70 dark:text-red-400 hover:bg-red-50/70 dark:hover:bg-red-900/40"
              @click="askDelete(p)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </header>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          Expected: <span class="font-medium">{{ p.expectedMinutes }} min</span>
        </p>

        <p class="text-xs" v-if="getDependency(p)">
          <span class="text-gray-500 dark:text-gray-400">Depends on:</span>
          <span class="ml-1 text-indigo-400">
            {{ getDependency(p)?.title }}
          </span>
        </p>
      </article>

      <p v-if="!loading && !plans.length" class="text-sm text-gray-500">
        No plans yet.
      </p>
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
import { PlusCircle, PenSquare, Trash2 } from 'lucide-vue-next'
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
    const r = await api.listPlans()
    plans.value = Array.isArray(r.items) ? r.items : r
  } finally {
    loading.value = false
  }
}

function getDependency(p: Plan) {
  if (!(p as any).dependsOn) return null
  const depId = Number((p as any).dependsOn)
  return plans.value.find((x: any) => Number(x.id) === depId) ?? null
}

function isDependencyInconsistent(p: Plan) {
  const dep = getDependency(p)
  if (!dep) return false
  return new Date(p.dueAt) < new Date(dep.dueAt)
}

onMounted(load)
</script>
