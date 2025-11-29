<!-- web/src/pages/Login.vue -->
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter, RouterLink } from 'vue-router';
import Card from '../components/ui/Card.vue';
import Field from '../components/ui/Field.vue';
import Input from '../components/ui/Input.vue';
import Button from '../components/ui/Button.vue';
import AlertMessage from '../components/common/AlertMessage.vue';
import { useApi } from '../lib/useApi';

const api = useApi();
const router = useRouter();

const form = reactive({
  email: '',
  password: '',
});

const loading = ref(false);
const error = ref<string | null>(null);

async function submit() {
  error.value = null;
  loading.value = true;
  try {
    const res = await api.login(form.email, form.password);

    // stocker token + user pour l’avatar, etc.
    localStorage.setItem('pw.token', res.token);
    localStorage.setItem('pw.user', JSON.stringify(res.user));

    await router.push('/');
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
            Sign in to PlanWatch
          </h1>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Use your email and password.
          </p>
        </header>

        <AlertMessage
          v-if="error"
          type="error"
          :show="true"
          dense
          :message="error"
        />

        <form class="space-y-4" @submit.prevent="submit">
          <Field label="Email">
            <Input
              v-model="form.email"
              type="email"
              required
              autocomplete="email"
            />
          </Field>

          <Field label="Password">
            <Input
              v-model="form.password"
              type="password"
              required
              autocomplete="current-password"
            />
          </Field>

          <Button
            type="submit"
            class="w-full"
            :disabled="loading"
          >
            <span v-if="!loading">Sign in</span>
            <span v-else>Signing in…</span>
          </Button>
        </form>

        <p class="text-xs text-slate-500 dark:text-slate-400">
          No account yet?
          <RouterLink
            to="/signup"
            class="font-medium text-brand hover:underline"
          >
            Create one
          </RouterLink>
        </p>
      </div>
    </Card>
  </div>
</template>
