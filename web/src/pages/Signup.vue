<!-- web/src/pages/Signup.vue -->
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
  fullName: '',
  email: '',
  password: '',
  confirm: '',
});

const loading = ref(false);
const error = ref<string | null>(null);

async function submit() {
  error.value = null;

  if (form.password !== form.confirm) {
    error.value = 'Passwords do not match.';
    return;
  }
  if (form.password.length < 8) {
    error.value = 'Password must be at least 8 characters.';
    return;
  }

  loading.value = true;
  try {
    const res = await api.signup(form.email, form.password, form.fullName || undefined);

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
            Create your PlanWatch account
          </h1>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            It only takes a minute.
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
          <Field label="Full name">
            <Input
              v-model="form.fullName"
              autocomplete="name"
              placeholder="Optional but nicer for your avatar"
            />
          </Field>

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
              autocomplete="new-password"
            />
          </Field>

          <Field label="Confirm password">
            <Input
              v-model="form.confirm"
              type="password"
              required
              autocomplete="new-password"
            />
          </Field>

          <Button
            type="submit"
            class="w-full"
            :disabled="loading"
          >
            <span v-if="!loading">Create account</span>
            <span v-else>Creating…</span>
          </Button>
        </form>

        <p class="text-xs text-slate-500 dark:text-slate-400">
          Already have an account?
          <RouterLink
            to="/login"
            class="font-medium text-brand hover:underline"
          >
            Sign in
          </RouterLink>
        </p>
      </div>
    </Card>
  </div>
</template>
