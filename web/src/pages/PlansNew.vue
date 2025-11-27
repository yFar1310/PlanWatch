<template>
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
    <form
      @submit.prevent="submit"
      class="grid gap-5 px-6 py-5"
    >
      <Field label="Title">
        <Input v-model="form.title" required minlength="3" placeholder="Write a clear, actionable title" />
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

      <Field label="Due at">
        <DatePicker
          v-model="form.dueAt"
          :enable-time="true"
          :is-24="true"
          :minutes-increment="5"
          :seconds-increment="1"
          :clearable="true"
          :auto-apply="true"
          placeholder="Select date & time"
          :teleport="false"
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
          :disabled="loading || !form.title || form.title.trim().length < 3 || !form.dueAt"
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

    <!-- Success modal as you already have -->
    <Modal
      :open="showSuccess"
      title="Plan created"
      @close="() => { showSuccess = false; router.push('/plans') }"
    >
      <template #icon>
        <CheckCircle class="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      </template>
      Your plan has been created successfully.
    </Modal>
  </Card>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, computed } from 'vue'
import Card from '../components/ui/Card.vue'
import Field from '../components/ui/Field.vue'
import Input from '../components/ui/Input.vue'
import Textarea from '../components/ui/TextArea.vue'
import Button from '../components/ui/Button.vue'
import { useApi } from '../lib/useApi'
import type { Plan } from '../types'
import { Send } from 'lucide-vue-next'
import DatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
const api = useApi()
import { useRouter } from 'vue-router';
const router = useRouter();
import Modal from '../components/common/Modal.vue'
import { CheckCircle } from 'lucide-vue-next'
import AlertMessage from '../components/common/AlertMessage.vue'

const form = reactive({
	title: '',
	expectedMinutes: 60,
	actualMinutes: undefined as number | undefined,
	dueAt: null as Date | null,  
	note: '',
  dependsOn: null as number | null,
})

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

onMounted(async () => {
  try {
    const r = await api.listPlans()
    allPlans.value = Array.isArray(r.items) ? r.items : r
  } catch (e) {
    console.warn('Failed to load plans for dependency select', e)
  }
})
function toIsoUtc(d: Date) {
  // force UTC ISO stable
  return new Date(
    Date.UTC(
      d.getFullYear(), d.getMonth(), d.getDate(),
      d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
    )
  ).toISOString()
}

async function submit() {
  error.value = null;
  response.value = null;

  if (!form.title || form.title.trim().length < 3) {
    error.value = 'Title must be at least 3 characters';
    return;
  }
  if (!form.dueAt) {
    error.value = 'Due date is required';
    return;
  }

  loading.value = true;
  try {
    const payload: Plan = {
      title: form.title.trim(),
      expectedMinutes: Number(form.expectedMinutes),
      actualMinutes: form.actualMinutes === undefined ? undefined : Number(form.actualMinutes),
      dueAt: toIsoUtc(form.dueAt as Date),
      note: form.note?.trim() || undefined,
      ...(form.dependsOn ? { dependsOn: form.dependsOn } : {}),
    };
    const j = await api.submitPlan(payload);
    response.value = JSON.stringify(j, null, 2);

    // ✅ reset du formulaire
    form.title = '';
    form.expectedMinutes = 60;
    form.actualMinutes = undefined;
    form.dueAt = null;
    form.note = '';

    showSuccess.value = true

    // (optionnel) petite notif visuelle, puis redirection
    setTimeout(() => router.push('/plans'), 300);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}
</script>