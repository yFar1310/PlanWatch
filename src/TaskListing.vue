<script setup lang="ts">
import { computed,ref } from 'vue';
import { getCoreRowModel,getSortedRowModel,useVueTable,type ColumnDef,type SortingState } from '@tanstack/vue-table';
import { ArrowDownWideNarrow,ArrowUpWideNarrow,SlidersHorizontal } from '@lucide/vue';
import type { Task } from '../shared/tasks';
const props=defineProps<{tasks:Task[];disabled:boolean;hasMore:boolean}>();
defineSlots<{default(props:{task:Task}):unknown}>();
const sort=ref('default'),descending=ref(false);
const sorting=computed<SortingState>(()=>sort.value==='default'?[]:[{id:sort.value,desc:descending.value}]);
const columns:ColumnDef<Task>[]=[
  {accessorKey:'title',sortingFn:'alphanumeric'},
  {id:'priority',accessorFn:task=>['urgent','high','medium','low'].indexOf(task.priority),sortingFn:'basic'},
  {id:'plannedDate',accessorFn:task=>task.plannedDate||undefined,sortUndefined:'last'},
  {id:'status',accessorFn:task=>['todo','doing','done'].indexOf(task.status),sortingFn:'basic'},
];
const table=useVueTable({get data(){return props.tasks;},columns,getRowId:task=>task.id,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),state:{get sorting(){return sorting.value;}}});
</script>
<template>
  <div class="task-listing">
    <div v-if="tasks.length" class="listing-toolbar"><div class="listing-count"><SlidersHorizontal :size="15" /><span>{{ tasks.length }} tasks{{ hasMore?' loaded':'' }}</span></div><label>Sort by<select v-model="sort" :disabled="disabled" aria-label="Sort tasks"><option value="default">Default order</option><option value="priority">Priority</option><option value="plannedDate">Planned date</option><option value="title">Title</option><option value="status">Status</option></select></label><button class="icon-button" :aria-label="descending?'Sort ascending':'Sort descending'" :disabled="disabled||sort==='default'" @click="descending=!descending"><ArrowDownWideNarrow v-if="descending" :size="17" /><ArrowUpWideNarrow v-else :size="17" /></button></div>
    <p v-if="hasMore&&sort!=='default'" class="listing-scope">Sorting applies to loaded tasks. Load more to include the next results.</p>
    <template v-for="row in table.getRowModel().rows" :key="row.id"><slot :task="row.original" /></template>
  </div>
</template>
