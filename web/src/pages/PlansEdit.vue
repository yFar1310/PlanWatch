<template>
  <div>
  <Card>
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Edit plan</h1>
    </div>

    <form v-if="!loading" class="grid gap-4" @submit.prevent="save">
      <Field label="Title">
        <Input v-model="form.title" required minlength="3" />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Expected minutes">
          <Input
            type="number"
            v-model.number="form.expectedMinutes"
            min="1"
            required
          />
        </Field>
        <Field label="Actual minutes (optional)">
          <Input
            type="number"
            v-model.number="form.actualMinutes"
            min="0"
          />
        </Field>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Status">
          <div class="inline-flex w-full rounded-xl bg-slate-100 p-1 text-xs
                      dark:bg-slate-900/70">
            <button
              v-for="opt in [
                { value: 'not_started', label: 'Not started' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'done', label: 'Done' },
              ]"
              :key="opt.value"
              type="button"
              class="flex-1 rounded-lg px-2 py-1"
              :class="form.status === opt.value
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                : 'text-slate-500 dark:text-slate-400'"
              @click="form.status = opt.value as PlanStatus"
            >
              {{ opt.label }}
            </button>
          </div>
        </Field>

          <Field label="Priority">
            <div class="inline-flex w-full rounded-xl bg-slate-100 p-1 text-xs
                        dark:bg-slate-900/70">
              <button
                type="button"
                class="flex-1 rounded-lg px-2 py-1"
                :class="form.priority <= -1
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'"
                @click="form.priority = -1"
              >
                Low
              </button>
              <button
                type="button"
                class="flex-1 rounded-lg px-2 py-1"
                :class="form.priority === 0
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'"
                @click="form.priority = 0"
              >
                Normal
              </button>
              <button
                type="button"
                class="flex-1 rounded-lg px-2 py-1"
                :class="form.priority >= 2
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'"
                @click="form.priority = 2"
              >
                High
              </button>
            </div>
          </Field>
        </div>


      <Field label="Due at">
        <DatePicker
          v-model="form.dueAt"
          :enable-time="true"
          :is-24="true"
          :minutes-increment="5"
          :seconds-increment="1"
          :auto-apply="true"
          :teleport="false"
          :min-date="dependencyMinDate"
          placeholder="Select date & time"
        />
      </Field>

      <Field label="Depends on (optional)">
        <select
          v-model="form.dependsOn"
          class="block w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
        >
          <option :value="null">No dependency</option>
          <option
            v-for="p in allPlans"
            :key="p.id"
            :value="p.id"
          >
            {{ p.title }}
          </option>
        </select>
      </Field>

      <Field label="Note">
        <Textarea v-model="form.note" maxlength="500" />
      </Field>

      <div class="flex items-center gap-2">
        <Button type="submit" :disabled="saving || !isValid">Save</Button>
        <RouterLink
          to="/plans"
          class="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900"
        >
          Cancel
        </RouterLink>
        <p v-if="error" class="text-sm text-red-600 ml-2">{{ error }}</p>
      </div>
    </form>

    <div v-else class="space-y-3">
      <div class="h-10 w-64 animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"></div>
      <div class="h-28 w-full animate-pulse rounded bg-gray-200/60 dark:bg-gray-800"></div>
    </div>
  </Card>

  <!-- Success modal -->
  <Modal :open="showSaved" title="Saved" @close="goBack">
    <template #icon>
      <CheckCircle class="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
    </template>
    Changes saved successfully.
  </Modal>
</div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import Card from '../components/ui/Card.vue'
import Field from '../components/ui/Field.vue'
import Input from '../components/ui/Input.vue'
import Textarea from '../components/ui/TextArea.vue'
import Button from '../components/ui/Button.vue'
import DatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import Modal from '../components/common/Modal.vue'
import { CheckCircle } from 'lucide-vue-next'
import { useApi } from '../lib/useApi'
import type { Plan, PlanStatus } from '../types'

const route = useRoute()
const router = useRouter()
const api = useApi()

const id = Number(route.params.id)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const showSaved = ref(false)

const form = reactive({
  title: '',
  expectedMinutes: 60,
  actualMinutes: undefined as number | undefined,
  dueAt: null as Date | null,
  note: '',
  dependsOn: null as number | null,
  status: 'not_started' as PlanStatus,
  priority: 0 as number,
});

const allPlans = ref<Plan[]>([])

const dependency = computed<Plan | null>(() => {
  if (!form.dependsOn) return null
  return (
    allPlans.value.find((p: any) => Number(p.id) === Number(form.dependsOn)) ??
    null
  )
})

const dependencyMinDate = computed<Date | undefined>(() => {
  if (!dependency.value) return undefined
  return new Date(dependency.value.dueAt)
})

onMounted(async () => {
  try {
    const [listRes, p] = await Promise.all([
      api.listPlans(),
      api.getPlan(id),
    ])

    const plan: Plan = (p?.plan ?? p) as Plan
    const items: Plan[] = Array.isArray(listRes.items) ? listRes.items : listRes

    allPlans.value = items.filter((x) => Number(x.id) !== id)

    form.title = plan.title
    form.expectedMinutes = plan.expectedMinutes
    form.actualMinutes = plan.actualMinutes ?? undefined
    form.dueAt = plan.dueAt ? new Date(plan.dueAt) : null
    form.note = plan.note ?? ''
    form.dependsOn = (plan.dependsOn ?? null) as number | null
    form.status = (plan.status as PlanStatus) ?? 'not_started';
    form.priority = plan.priority ?? 0;
  } catch (e: any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
})

const isValid = computed(
  () =>
    !!form.title &&
    form.title.trim().length >= 3 &&
    !!form.dueAt &&
    Number(form.expectedMinutes) > 0
)

async function save() {
  if (!isValid.value) return
  saving.value = true
  error.value = null
  try {
    const patch: Partial<Plan> = {
      title: form.title.trim(),
      expectedMinutes: Number(form.expectedMinutes),
      actualMinutes: form.actualMinutes ?? undefined,
      dueAt: form.dueAt ? (form.dueAt as Date).toISOString() : undefined,
      note: form.note?.trim() || undefined,
      dependsOn: form.dependsOn ?? null,
      status: form.status,
      priority: form.priority,
    }
    await api.updatePlan(id, patch)
    showSaved.value = true
  } catch (e: any) {
    error.value = e?.message ?? String(e)
  } finally {
    saving.value = false
  }
}

function goBack() {
  showSaved.value = false
  router.push('/plans')
}
</script>
