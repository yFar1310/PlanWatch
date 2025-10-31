<template>
	<Card>
		<form @submit.prevent="submit" class="grid gap-4">
			<Field label="Title">
				<Input v-model="form.title" required minlength="3" />
			</Field>

			<div class="grid grid-cols-2 gap-4">
				<Field label="Expected minutes">
					<Input type="number" v-model.number="form.expectedMinutes" required min="1" />
				</Field>
				<Field label="Actual minutes (optional)">
					<Input type="number" v-model.number="form.actualMinutes" min="0" />
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
				<Textarea v-model="form.note" maxlength="500" />
			</Field>

			<div class="flex items-center gap-3">
				<Button type="submit" :disabled="loading || !form.title || form.title.trim().length < 3 || !form.dueAt">
                <span v-if="!loading" class="inline-flex items-center gap-2">
                    <Send class="h-4 w-4" />
                    <span>Submit</span>
                </span>
                <span v-else>Submitting…</span>
                </Button>
                <AlertMessage
                v-if="response"
                type="success"
                :show="true"
                dense
                message="Plan created successfully."
                >
                <template #actions>
                    <RouterLink
                    to="/plans"
                    class="text-sm font-medium underline underline-offset-2 hover:opacity-80"
                    >View all</RouterLink>
                </template>
                </AlertMessage>

                <AlertMessage
                v-else-if="error"
                type="danger"
                :show="true"
                :message="error"
                />

				<p v-if="error" class="text-sm text-red-600">{{ error }}</p>
				<p v-else-if="response" class="text-sm text-gray-600">Saved ✓</p>
			</div>

			<details v-if="response" class="mt-2">
				<summary class="cursor-pointer text-sm text-gray-600">Show API response</summary>
				<pre class="mt-2 text-xs bg-gray-50 p-3 rounded-xl overflow-auto">{{ response }}</pre>
			</details>
		</form>
        <Modal :open="showSuccess" title="Plan created" @close="() => { showSuccess = false; router.push('/plans') }">
        <template #icon>
            <CheckCircle class="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        </template>
        Your plan has been created successfully.
        </Modal>
	</Card>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue'
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
const showSuccess = ref(false)
import AlertMessage from '../components/common/AlertMessage.vue'

const form = reactive({
	title: '',
	expectedMinutes: 60,
	actualMinutes: undefined as number | undefined,
	dueAt: null as Date | null,  
	note: ''
})

const loading = ref(false)
const response = ref<string | null>(null)
const error = ref<string | null>(null)


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