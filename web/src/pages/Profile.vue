<!-- web/src/pages/Profile.vue -->
<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import Card from '../components/ui/Card.vue';
import Field from '../components/ui/Field.vue';
import Input from '../components/ui/Input.vue';
import Button from '../components/ui/Button.vue';
import AlertMessage from '../components/common/AlertMessage.vue';
import { useApi } from '../lib/useApi';
import type { User } from '../types';

const api = useApi();

const form = reactive({
  fullName: '',
});

const preview = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const success = ref<string | null>(null);

function loadFromLocal() {
  const raw = localStorage.getItem('pw.user');
  if (!raw) return;
  try {
    const u = JSON.parse(raw) as User;
    form.fullName = u.fullName || '';
    preview.value = u.avatarData || null;
  } catch {}
}

onMounted(async () => {
  loadFromLocal();
  try {
    const { user } = await api.getMe();
    form.fullName = user.fullName || '';
    preview.value = user.avatarData || null;
    localStorage.setItem('pw.user', JSON.stringify(user));
  } catch {
    // ignore, on reste sur le local
  }
});

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  if (file.size > 200_000) {
    error.value = 'Image too large (max ~200 KB).';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    preview.value = reader.result as string;
  };
  reader.readAsDataURL(file);
}

async function submit() {
  error.value = null;
  success.value = null;
  loading.value = true;

  try {
    const payload: { fullName?: string; avatarData?: string | null } = {};
    payload.fullName = form.fullName || undefined;
    payload.avatarData = preview.value ?? null;

    const { user } = await api.updateProfile(payload);
    localStorage.setItem('pw.user', JSON.stringify(user));
    success.value = 'Profile updated.';
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <Card class="w-full max-w-md">
      <div class="card-body space-y-5">
        <header class="space-y-1">
          <h1 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Your profile
          </h1>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Update your name and avatar.
          </p>
        </header>

        <AlertMessage
          v-if="error"
          type="error"
          :show="true"
          dense
          :message="error"
        />
        <AlertMessage
          v-if="success"
          type="success"
          :show="true"
          dense
          :message="success"
        />

        <form class="space-y-4" @submit.prevent="submit">
          <div class="flex items-center gap-4">
            <div
              class="h-16 w-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500
                     flex items-center justify-center text-white text-sm font-semibold
                     overflow-hidden"
            >
              <img
                v-if="preview"
                :src="preview"
                alt="Avatar preview"
                class="h-full w-full object-cover"
              />
              <span v-else>?</span>
            </div>

            <div class="space-y-1">
              <label class="text-xs font-medium text-slate-700 dark:text-slate-200">
                Avatar
              </label>
              <input
                type="file"
                accept="image/*"
                @change="onFileChange"
                class="block text-xs text-slate-600 dark:text-slate-300"
              />
              <p class="text-[10px] text-slate-400">
                Small image, ideally &lt; 200 KB.
              </p>
            </div>
          </div>

          <Field label="Full name">
            <Input v-model="form.fullName" autocomplete="name" />
          </Field>

          <Button type="submit" class="w-full" :disabled="loading">
            <span v-if="!loading">Save</span>
            <span v-else>Saving…</span>
          </Button>
        </form>
      </div>
    </Card>
  </div>
</template>
