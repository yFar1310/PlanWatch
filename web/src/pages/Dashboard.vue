<script setup lang="ts">
import { Timer, Calendar, Activity as ActivityIcon, Download } from 'lucide-vue-next'
import { onMounted, ref, computed } from 'vue'
import { useApi } from '../lib/useApi'
import { formatMinutes } from '../lib/format';
import type { DashboardStats, ActivityEvent, Plan } from '../types'
import PERTGraph  from '../components/PERT/PERTGraph.vue'; 
import Card from '../components/ui/Card.vue';
const api = useApi()

type PertTask = {
  id: number
  title: string
  duration: number
  dependsOn: number | null
  es: number
  ef: number
  ls: number
  lf: number
  slack: number
}

const pertLoading = ref(true)
const pertError = ref<string | null>(null)
const pertTasks = ref<PertTask[]>([])
const pertProjectDuration = ref(0)

// --- Stats (Postgres) ---
const stats = ref<DashboardStats | null>(null)
const statsLoading = ref(true)
const statsError = ref<string | null>(null)

// --- Activity (Mongo) ---
const events = ref<ActivityEvent[]>([])
const eventsLoading = ref(true)
const eventsError = ref<string | null>(null)
const downloadingActivity = ref(false)

// --- Plans for board (Postgres) ---
const plans = ref<Plan[]>([])
const plansLoading = ref(true)
const plansError = ref<string | null>(null)

// filter like Notion tabs
type TaskFilter = 'all' | 'today' | 'week' | 'year'
const taskFilter = ref<TaskFilter>('all')

const taskFilterOptions: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'year', label: 'This year' },
]

// --- helpers dates ---
function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function startOfWeek(d: Date) {
  const x = startOfDay(d)
  const day = x.getDay() || 7 // Monday=1..Sunday=7
  const diff = day - 1
  x.setDate(x.getDate() - diff)
  return x
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d)
  s.setDate(s.getDate() + 6)
  s.setHours(23, 59, 59, 999)
  return s
}

async function handleDownloadActivity() {
  if (!events.value.length) return
  downloadingActivity.value = true
  try {
    await api.downloadActivityPdf()
  } catch (e: any) {
    eventsError.value = e?.message ?? 'Failed to download activity'
  } finally {
    downloadingActivity.value = false
  }
}


// --- initial load ---
onMounted(async () => {
  // Stats (Postgres)
  try {
    const s = await api.getStats()
    stats.value = s
  } catch (e: any) {
    statsError.value = e?.message ?? String(e)
  } finally {
    statsLoading.value = false
  }

  // Activity (Mongo)
  try {
    const r = await api.listActivity(8)
    events.value = Array.isArray(r.items) ? r.items : (r as any)
  } catch (e: any) {
    eventsError.value = e?.message ?? String(e)
  } finally {
    eventsLoading.value = false
  }

  // Plans (Postgres) for board
  try {
    const r = await api.listPlans({ order: 'due_at', dir: 'asc', limit: 200 })
    plans.value = Array.isArray(r.items) ? r.items : r
  } catch (e: any) {
    plansError.value = e?.message ?? String(e)
  } finally {
    plansLoading.value = false
  }

  // PERT
  try {
    const p = await api.pert()
    pertTasks.value = p.tasks
    pertProjectDuration.value = p.projectDuration
  } catch (e: any) {
    pertError.value = e?.message ?? String(e)
  } finally {
    pertLoading.value = false
  }
})

// --- derived stats ---
const todayDelta = computed(() => {
  if (!stats.value) return 0
  return (stats.value.todayActualMinutes ?? 0) - (stats.value.todayExpectedMinutes ?? 0)
})

const eventTypeLabel: Record<string, string> = {
  plan_submitted: 'Created',
  plan_updated: 'Updated',
  plan_deleted: 'Deleted',
}

// --- tasks board logic ---

// Filter by Today / Week / Year
const filteredPlans = computed(() => {
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)

  return plans.value.filter((p) => {
    const due = new Date(p.dueAt)
    switch (taskFilter.value) {
      case 'today':
        return due >= todayStart && due <= todayEnd
      case 'week':
        return due >= weekStart && due <= weekEnd
      case 'year':
        return due >= yearStart && due <= yearEnd
      default:
        return true
    }
  })
})

// Board columns: Not started / In progress / Done
const boardByStatus = computed(() => {
  const res = {
    notStarted: [] as Plan[],
    inProgress: [] as Plan[],
    done: [] as Plan[],
  }
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)

  for (const p of filteredPlans.value) {
    const due = new Date(p.dueAt)
    const isDone = p.actualMinutes != null && p.actualMinutes > 0

    if (isDone) {
      res.done.push(p)
    } else if (due >= todayStart && due <= todayEnd) {
      // we "promote" today's tasks as in progress
      res.inProgress.push(p)
    } else {
      res.notStarted.push(p)
    }
  }

  return res
})

// Badges style: Do it today / remaining / overdue / done
function statusBadge(p: Plan) {
  const now = new Date()
  const todayStart = startOfDay(now)
  const due = new Date(p.dueAt)
  const isDone = p.actualMinutes != null && p.actualMinutes > 0

  if (isDone) return { label: 'Done', variant: 'done' as const }

  if (due < todayStart) {
    return { label: 'Overdue', variant: 'danger' as const }
  }

  const diffDays = Math.round(
    (startOfDay(due).getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (diffDays === 0) return { label: 'Do it today!', variant: 'today' as const }
  if (diffDays === 1) return { label: '1 day remaining', variant: 'soon' as const }

  return { label: `${diffDays} days remaining`, variant: 'soon' as const }
}

function badgeClass(variant: 'danger' | 'today' | 'soon' | 'done') {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px]'
  switch (variant) {
    case 'danger':
      return `${base} bg-rose-500/10 text-rose-300`
    case 'today':
      return `${base} bg-amber-500/10 text-amber-300`
    case 'soon':
      return `${base} bg-sky-500/10 text-sky-300`
    case 'done':
      return `${base} bg-emerald-500/10 text-emerald-300`
  }
}

function formatDateShort(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}
</script>

<template>
  <div class="space-y-8">
    <!-- Top stats row -->
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- Today -->
      <section class="card">
        <div class="card-body">
          <div class="flex items-center gap-3">
            <Timer class="h-5 w-5 text-brand" />
            <h2 class="font-semibold">Today</h2>
          </div>

          <div class="mt-4 text-sm">
            <div v-if="statsLoading" class="space-y-2">
              <div class="h-4 w-40 rounded bg-gray-200/60 dark:bg-gray-800 animate-pulse" />
              <div class="h-4 w-32 rounded bg-gray-200/60 dark:bg-gray-800 animate-pulse" />
              <div class="h-4 w-24 rounded bg-gray-200/60 dark:bg-gray-800 animate-pulse" />
            </div>

            <p v-else-if="statsError" class="text-sm text-red-500">
              {{ statsError }}
            </p>

            <div v-else-if="stats">
              <p class="text-gray-400 dark:text-gray-400">
                {{ stats.todayCount }} plan<span v-if="stats.todayCount !== 1">s</span> due today.
              </p>
              <p class="mt-2">
                Planned:
                <span class="font-semibold">
                  {{ formatMinutes(stats.todayExpectedMinutes) }}
                </span>
              </p>
              <p class="mt-1">
                Actual:
                <span class="font-semibold">
                  {{ formatMinutes(stats.todayActualMinutes ?? 0) }}
                </span>
              </p>
              <p v-if="todayDelta !== 0" class="mt-1 text-xs">
                Delta:
                <span :class="todayDelta > 0 ? 'text-emerald-400' : 'text-amber-400'">
                  {{ todayDelta > 0 ? '+' : '' }}{{ formatMinutes(Math.abs(todayDelta)) }}
                </span>
              </p>
            </div>

            <p v-else class="text-sm text-gray-500">No data yet.</p>
          </div>
        </div>
      </section>

      <!-- Upcoming -->
      <section class="card">
        <div class="card-body">
          <div class="flex items-center gap-3">
            <Calendar class="h-5 w-5 text-brand" />
            <h2 class="font-semibold">Upcoming</h2>
          </div>

          <div class="mt-4 text-sm">
            <div v-if="statsLoading" class="h-4 w-32 rounded bg-gray-200/60 dark:bg-gray-800 animate-pulse" />

            <p v-else-if="statsError" class="text-sm text-red-500">
              {{ statsError }}
            </p>

            <p v-else-if="stats">
              {{ stats.upcomingCount }} plan<span v-if="stats.upcomingCount !== 1">s</span>
              due in the next 7 days.
              <br />
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ stats.plansWithDependency }} with dependencies.
              </span>
            </p>

            <p v-else class="text-sm text-gray-500">
              No upcoming plans yet.
            </p>
          </div>
        </div>
      </section>

      <!-- Recent activity (Mongo) -->
      <section class="card sm:col-span-2 lg:col-span-1">
        <div class="card-body">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <ActivityIcon class="h-5 w-5 text-brand" />
              <h2 class="font-semibold text-sm">Recent activity</h2>
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-slate-700/60
                    px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800
                    disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="eventsLoading || !events.length || downloadingActivity"
              @click="handleDownloadActivity"
            >
              <Download class="h-3 w-3" />
              <span>{{ downloadingActivity ? 'Preparing…' : 'Download' }}</span>
            </button>
          </div>

          <div class="mt-4">
            <div v-if="eventsLoading" class="space-y-2">
              <div
                v-for="i in 4"
                :key="i"
                class="h-4 w-3/4 rounded bg-gray-200/60 dark:bg-gray-800 animate-pulse"
              />
            </div>

            <p v-else-if="eventsError" class="text-sm text-red-500">
              {{ eventsError }}
            </p>

            <p v-else-if="!events.length" class="text-sm text-gray-500">
              No events yet.
            </p>

            <ul v-else class="space-y-2 text-sm">
              <li
                v-for="e in events"
                :key="e.id"
                class="flex items-center justify-between"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                    :class="{
                      'bg-emerald-500/10 text-emerald-300': e.type === 'plan_submitted',
                      'bg-sky-500/10 text-sky-300': e.type === 'plan_updated',
                      'bg-rose-500/10 text-rose-300': e.type === 'plan_deleted',
                    }"
                  >
                    {{ eventTypeLabel[e.type] ?? e.type }}
                  </span>
                  <span class="text-gray-200 dark:text-gray-100">
                    Plan #{{ e.planId ?? '?' }}
                  </span>
                </div>
                <span class="text-xs text-gray-400">
                  {{ new Date(e.at).toLocaleString() }}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>

        <!-- Tasks board -->
       <!-- Tasks board -->
<section class="mt-8 space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-200">
      Tasks
    </h2>
    <div
      class="inline-flex rounded-full bg-slate-100 border border-slate-200 p-1 text-xs
             dark:bg-slate-900/70 dark:border-slate-800"
    >
      <button
        v-for="opt in taskFilterOptions"
        :key="opt.value"
        type="button"
        class="px-3 py-1 rounded-full transition"
        :class="opt.value === taskFilter
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'"
        @click="taskFilter = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>

  <!-- 3 colonnes : Not started / In progress / Done -->
  <div class="grid gap-4 lg:grid-cols-3">
    <!-- NOT STARTED -->
    <div
      class="rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur
             dark:border-slate-800/80 dark:bg-slate-950/60 flex flex-col"
    >
      <div class="px-4 py-3 flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Not started
        </span>
        <span class="text-xs text-slate-400 dark:text-slate-500">
          {{ boardByStatus.notStarted.length }}
        </span>
      </div>

      <div class="px-4 pb-4 space-y-2 flex-1">
        <div
          v-for="p in boardByStatus.notStarted"
          :key="p.id"
          class="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs space-y-1
                 flex items-center justify-between gap-3
                 dark:border-slate-800 dark:bg-slate-900/70
                 hover:bg-slate-100/90 dark:hover:bg-slate-900 transition"
        >
          <div class="min-w-0">
            <div class="font-medium truncate text-slate-900 dark:text-slate-50">
              {{ p.title }}
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              {{ formatDateShort(p.dueAt) }}
            </p>
          </div>
          <span
            v-tooltip="statusBadge(p).label"
            :class="badgeClass(statusBadge(p).variant)"
          >
            {{ statusBadge(p).label }}
          </span>
        </div>

        <p
          v-if="!boardByStatus.notStarted.length"
          class="text-xs text-slate-400 dark:text-slate-500"
        >
          No tasks in this column.
        </p>
      </div>
    </div>

    <!-- IN PROGRESS -->
    <div
      class="rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur
             dark:border-slate-800/80 dark:bg-slate-950/60 flex flex-col"
    >
      <div class="px-4 py-3 flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          In progress
        </span>
        <span class="text-xs text-slate-400 dark:text-slate-500">
          {{ boardByStatus.inProgress.length }}
        </span>
      </div>

      <div class="px-4 pb-4 space-y-2 flex-1">
        <div
          v-for="p in boardByStatus.inProgress"
          :key="p.id"
          class="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs space-y-1
                 flex items-center justify-between gap-3
                 dark:border-slate-800 dark:bg-slate-900/70
                 hover:bg-slate-100/90 dark:hover:bg-slate-900 transition"
        >
          <div class="min-w-0">
            <div class="font-medium truncate text-slate-900 dark:text-slate-50">
              {{ p.title }}
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              {{ formatDateShort(p.dueAt) }}
            </p>
          </div>
          <span
            v-tooltip="statusBadge(p).label"
            :class="badgeClass(statusBadge(p).variant)"
          >
            {{ statusBadge(p).label }}
          </span>
        </div>

        <p
          v-if="!boardByStatus.inProgress.length"
          class="text-xs text-slate-400 dark:text-slate-500"
        >
          Nothing in progress.
        </p>
      </div>
    </div>

    <!-- DONE -->
    <div
      class="rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur
             dark:border-slate-800/80 dark:bg-slate-950/60 flex flex-col"
    >
      <div class="px-4 py-3 flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Done
        </span>
        <span class="text-xs text-slate-400 dark:text-slate-500">
          {{ boardByStatus.done.length }}
        </span>
      </div>

      <div class="px-4 pb-4 space-y-2 flex-1">
        <div
          v-for="p in boardByStatus.done"
          :key="p.id"
          class="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs space-y-1
                 flex items-center justify-between gap-3
                 dark:border-slate-800 dark:bg-slate-900/70
                 hover:bg-slate-100/90 dark:hover:bg-slate-900 transition"
        >
          <div class="min-w-0">
            <div class="font-medium truncate text-slate-900 dark:text-slate-50">
              {{ p.title }}
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              Done {{ formatDateShort(p.dueAt) }}
            </p>
          </div>
          <span
            v-tooltip="statusBadge(p).label"
            :class="badgeClass(statusBadge(p).variant)"
          >
            {{ statusBadge(p).label }}
          </span>
        </div>

        <p
          v-if="!boardByStatus.done.length"
          class="text-xs text-slate-400 dark:text-slate-500"
        >
          No completed tasks yet.
        </p>
      </div>
    </div>
  </div>
</section>





    <section class="mt-8">
    <Card>
      <div class="card-body space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-sm">PERT timeline</h2>
          <p v-if="!pertLoading && !pertError" class="text-xs text-slate-400">
            Project duration:
            <span class="font-mono">
              {{ formatMinutes(pertProjectDuration) }}
            </span>
          </p>
        </div>

        <div v-if="pertLoading" class="h-40 flex items-center justify-center text-sm text-slate-500">
          Loading PERT diagram…
        </div>

        <p v-else-if="pertError" class="text-sm text-red-500">
          {{ pertError }}
        </p>

        <PERTGraph
          v-else
          :tasks="pertTasks"
          :project-duration="pertProjectDuration"
        />
      </div>
    </Card>
  </section>
  </div>
</template>
