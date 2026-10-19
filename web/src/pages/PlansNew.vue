<template>
  <div>
  <Card class="max-w-2xl mx-auto">
    <!-- Card header -->
    <div class="border-b border-slate-100 px-6 py-4 dark:border-slate-800">
      <h1 class="text-base font-semibold text-slate-900 dark:text-slate-50">
        New Plan
      </h1>
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Define a task, estimate its duration and its deadline. You can always edit it later.
      </p>
    </div>

    <!-- Form body -->
    <form @submit.prevent="submit" class="grid gap-5 px-6 py-5">
      <Field label="Title">
        <Input
          v-model="form.title"
          required
          minlength="3"
          placeholder="Write a clear, actionable title"
        />
      </Field>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Expected minutes">
          <Input
            type="number"
            v-model.number="form.expectedMinutes"
            required
            min="1"
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

      <Field label="Depends on (optional)">
        <select
          v-model="form.dependsOn"
          class="block w-full rounded-xl border border-gray-200 dark:border-gray-800
                 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
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

      <Field label="Due at">
        <DatePicker
          v-model="form.dueAt"
          :enable-time="true"
          :is-24="true"
          :minutes-increment="5"
          :seconds-increment="1"
          :clearable="true"
          :auto-apply="true"
          :teleport="false"
          :min-date="dependencyMinDate"
          placeholder="Select date & time"
        />
      </Field>

      <Field label="Note">
        <Textarea
          v-model="form.note"
          maxlength="500"
          placeholder="Optional context, links, or acceptance criteria…"
          class="min-h-[80px]"
        />
      </Field>

      <!-- errors / api feedback -->
      <AlertMessage
        v-if="error"
        type="error"
        :show="true"
        dense
        :message="error"
      />
      <AlertMessage
        v-else-if="response"
        type="success"
        :show="true"
        dense
        message="Plan created successfully."
      />

      <!-- Card footer -->
      <div
        class="mt-2 flex items-center justify-between border-t border-slate-100 pt-4
               text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"
      >
        <RouterLink
          to="/plans"
          class="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200"
        >
          Cancel
        </RouterLink>

        <Button
          type="submit"
          :disabled="loading || !isValid"
          class="inline-flex items-center gap-2"
        >
          <span v-if="!loading" class="inline-flex items-center gap-2">
            <Send class="h-4 w-4" />
            <span>Create plan</span>
          </span>
          <span v-else>Creating…</span>
        </Button>
      </div>
    </form>

    <!-- Success modal -->
    <Modal
      :open="showSuccess"
      title="Plan created"
      @close="() => { showSuccess = false; router.push('/plans') }"
    >
      <template #icon>
        <CheckCircle
          class="h-6 w-6 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
      </template>
      Your plan has been created successfully.
    </Modal>
  </Card>
</div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import Card from '../components/ui/Card.vue'
import Field from '../components/ui/Field.vue'
import Input from '../components/ui/Input.vue'
import Textarea from '../components/ui/TextArea.vue'
import Button from '../components/ui/Button.vue'
import DatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import { Send, CheckCircle } from 'lucide-vue-next'
import Modal from '../components/common/Modal.vue'
import AlertMessage from '../components/common/AlertMessage.vue'
import { useApi } from '../lib/useApi'
import type { Plan, PlanStatus } from '../types'

const api = useApi()
const router = useRouter()

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

const loading = ref(false)
const response = ref<string | null>(null)
const error = ref<string | null>(null)
const showSuccess = ref(false)

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

const isValid = computed(() =>
  !!form.title &&
  form.title.trim().length >= 3 &&
  !!form.dueAt &&
  Number(form.expectedMinutes) > 0
)

onMounted(async () => {
  try {
    const r = await api.listPlans()
    allPlans.value = Array.isArray(r.items) ? r.items : r
  } catch (e) {
    console.warn('Failed to load plans for dependency select', e)
  }
})

async function submit() {
  if (loading.value) return
  error.value = null
  response.value = null

  if (!isValid.value) {
    if (!form.title || form.title.trim().length < 3) {
      error.value = 'Title must be at least 3 characters'
    } else if (!form.dueAt) {
      error.value = 'Due date is required'
    } else if (!form.expectedMinutes || Number(form.expectedMinutes) <= 0) {
      error.value = 'Expected minutes must be greater than 0'
    }
    return
  }

  loading.value = true
  try {
    const payload: Plan = {
          title: form.title.trim(),
          expectedMinutes: Number(form.expectedMinutes),
          actualMinutes:
            form.actualMinutes === undefined ? undefined : Number(form.actualMinutes),
          dueAt: (form.dueAt as Date).toISOString(),
          note: form.note?.trim() || undefined,
          dependsOn: form.dependsOn ?? null,
          status: form.status,
          priority: form.priority,
        };

    const j = await api.submitPlan(payload)
    response.value = JSON.stringify(j, null, 2)

    // reset form
    form.title = ''
    form.expectedMinutes = 60
    form.actualMinutes = undefined
    form.dueAt = null
    form.note = ''
    form.dependsOn = null
    form.status = 'not_started';
    form.priority = 0;

    showSuccess.value = true
  } catch (e: any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}
</script>
