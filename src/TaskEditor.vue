<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, Trash2 } from '@lucide/vue';
import type { Task } from '../shared/tasks';
import { nextDay } from '../shared/calendar';
import { clearDraft, drafts, fromTask, storageAvailable, type TaskDraft } from './drafts';

const props = defineProps<{ task: Task; disabled: boolean; canSave: boolean; today: string }>();
const emit = defineEmits<{ save: [draft: TaskDraft]; delete: []; close: [] }>();
const draft = ref<TaskDraft>({ ...(drafts.value[props.task.id] ?? fromTask(props.task)) });
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(fromTask(props.task)));
const stale = computed(() => draft.value.version !== props.task.version);
watch(draft, () => {
  if (dirty.value) drafts.value[props.task.id] = { ...draft.value };
  else clearDraft(props.task.id);
}, { deep: true, flush: 'sync' });
function discard() { clearDraft(props.task.id); emit('close'); }
function useSaved() { draft.value = fromTask(props.task); clearDraft(props.task.id); }
</script>

<template>
  <form class="task-details" @submit.prevent="emit('save', { ...draft })">
    <fieldset :disabled="disabled">
      <div v-if="stale" class="conflict-message" role="alert">
        This task changed elsewhere. Your draft is kept. Review the saved version before editing again.
        <button class="secondary" type="button" @click="useSaved">Replace draft with saved version</button>
      </div>
      <label>Title<input v-model="draft.title" required maxlength="200" /></label>
      <label>Notes <span>optional</span><textarea v-model="draft.notes" maxlength="5000" rows="3" placeholder="Anything you want to remember…"></textarea></label>
      <label>Planned day <span>optional</span><input v-model="draft.plannedDate" type="date" min="0001-01-01" max="9999-12-31" /></label>
      <div class="date-shortcuts" aria-label="Reschedule task">
        <button type="button" class="date-chip" @click="draft.plannedDate = today">Today</button>
        <button type="button" class="date-chip" @click="draft.plannedDate = nextDay(today)">Tomorrow</button>
        <button type="button" class="date-chip" @click="draft.plannedDate = ''">No date</button>
      </div>
      <div class="detail-grid">
        <label>Status<select v-model="draft.status"><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option></select></label>
        <label>Estimate <span>minutes</span><input v-model="draft.estimate" type="number" min="1" step="1" placeholder="—" /></label>
        <label>Time spent <span>minutes</span><input v-model="draft.actual" type="number" min="0" step="1" placeholder="—" /></label>
      </div>
      <p class="draft-note">{{ dirty ? (storageAvailable ? 'Unsaved draft kept on this device.' : 'Draft kept while this page stays open. Browser storage is unavailable.') : 'Changes are saved when you choose Save changes.' }}</p>
      <div class="detail-actions">
        <button type="button" class="delete-button" :disabled="!canSave" @click="emit('delete')"><Trash2 :size="16" />Delete</button>
        <div><button type="button" class="secondary" @click="discard">{{ dirty ? 'Discard draft' : 'Cancel' }}</button><button class="primary" type="submit" :disabled="!canSave || stale || !dirty || !draft.title.trim()">Save changes<ArrowRight :size="16" /></button></div>
      </div>
    </fieldset>
  </form>
</template>
