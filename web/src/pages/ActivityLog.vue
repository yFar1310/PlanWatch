<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { RouterLink } from 'vue-router';
import Card from '../components/ui/Card.vue';
import { useApi } from '../lib/useApi';
import type { ActivityEvent } from '../types';
import ScrollTopFab from '../components/common/ScrollTopFab.vue';

const api = useApi();

type Filter = 'all' | 'created' | 'updated' | 'deleted';

const filters: { value: Filter; label: string }[] = [
  { value: 'all',     label: 'All' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'deleted', label: 'Deleted' },
];

const events = ref<ActivityEvent[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const nextCursor = ref<string | null>(null);

const typeFilter = ref<Filter>('all');

const eventTypeLabel: Record<string, string> = {
  plan_submitted: 'Created',
  plan_updated: 'Updated',
  plan_deleted: 'Deleted',
};

function matchesFilter(e: ActivityEvent) {
  switch (typeFilter.value) {
    case 'created':
      return e.type === 'plan_submitted';
    case 'updated':
      return e.type === 'plan_updated';
    case 'deleted':
      return e.type === 'plan_deleted';
    default:
      return true;
  }
}

const filteredEvents = computed(() =>
  events.value.filter(matchesFilter),
);

const hasMore = computed(() => !!nextCursor.value);

async function loadInitial() {
  loading.value = true;
  error.value = null;
  try {
    const r = await api.listActivity({ limit: 40 });
    events.value = r.items ?? [];
    nextCursor.value = r.nextCursor ?? null;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const r = await api.listActivity({ limit: 40, before: nextCursor.value });
    events.value = events.value.concat(r.items ?? []);
    nextCursor.value = r.nextCursor ?? null;
  } catch (e: any) {
    // on log juste en console pour ne pas casser l'UI
    console.error('loadMore activity failed', e);
  } finally {
    loadingMore.value = false;
  }
}

// IntersectionObserver pour l'infinite scroll
const loadMoreEl = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(async () => {
  await loadInitial();

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        loadMore();
      }
    },
    { root: null, rootMargin: '0px 0px 200px 0px', threshold: 0 },
  );

  if (loadMoreEl.value) {
    observer.observe(loadMoreEl.value);
  }
});

onBeforeUnmount(() => {
  if (observer) observer.disconnect();
});

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}
</script>

<template>
  <div class="space-y-5 pb-24">
    <header class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Activity log
        </h1>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
          All plan changes, newest first. Scroll to load more.
        </p>
      </div>

      <RouterLink
        to="/"
        class="inline-flex items-center gap-2 rounded-full border
               border-slate-200 dark:border-slate-700/70
               px-3 py-1.5 text-xs
               text-slate-700 dark:text-slate-200
               hover:bg-slate-50 dark:hover:bg-slate-800/70"
      >
        Back to dashboard
      </RouterLink>
    </header>

    <!-- Filters -->
    <div
      class="inline-flex rounded-full
             bg-white/80 border border-slate-200
             dark:bg-slate-900/80 dark:border-slate-800
             p-1 text-xs"
    >
      <button
        v-for="f in filters"
        :key="f.value"
        type="button"
        class="px-3 py-1 rounded-full transition"
        :class="f.value === typeFilter
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'"
        @click="typeFilter = f.value"
      >
        {{ f.label }}
      </button>
    </div>

    <Card>
      <div class="card-body">
        <!-- Loading -->
        <div v-if="loading" class="space-y-3">
          <div
            v-for="i in 6"
            :key="i"
            class="h-5 w-full rounded bg-slate-200/70 dark:bg-slate-800/70 animate-pulse"
          />
        </div>

        <!-- Error -->
        <p v-else-if="error" class="text-sm text-rose-500 dark:text-rose-400">
          {{ error }}
        </p>

        <!-- List -->
        <template v-else>
          <ul class="divide-y divide-slate-200 dark:divide-slate-800/80">
            <li
              v-for="e in filteredEvents"
              :key="e.id"
              class="py-3 flex items-center justify-between gap-3"
            >
              <div class="flex items-center gap-3 min-w-0">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
                  :class="{
                    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300':
                      e.type === 'plan_submitted',
                    'bg-sky-500/10 text-sky-600 dark:text-sky-300':
                      e.type === 'plan_updated',
                    'bg-rose-500/10 text-rose-600 dark:text-rose-300':
                      e.type === 'plan_deleted',
                  }"
                >
                  {{ eventTypeLabel[e.type] ?? e.type }}
                </span>

                <div class="min-w-0">
                  <p class="text-sm text-slate-900 dark:text-slate-100 truncate">
                    Plan #{{ e.planId ?? '?' }}
                  </p>
                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {{ e.dependsOn ? `Depends on #${e.dependsOn}` : 'No dependency info' }}
                  </p>
                </div>
              </div>

              <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                {{ formatWhen(e.at) }}
              </span>
            </li>
          </ul>

          <p
            v-if="!filteredEvents.length"
            class="mt-6 text-sm text-slate-500 dark:text-slate-400"
          >
            No events matching this filter.
          </p>

          <!-- Infinite scroll sentinel -->
          <div
            ref="loadMoreEl"
            class="mt-4 flex items-center justify-center text-xs
                   text-slate-500 dark:text-slate-500"
          >
            <span v-if="hasMore && !loadingMore">
              Scroll to load more…
            </span>
            <span v-else-if="loadingMore">
              Loading more…
            </span>
            <span v-else>
              You reached the end of the log.
            </span>
          </div>
        </template>
      </div>
    </Card>

    <!-- FAB back to top -->
    <ScrollTopFab :bottom="88" />
  </div>
</template>
