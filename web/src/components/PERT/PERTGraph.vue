<template>
  <div class="space-y-2">
    <div class="relative">
      <div
        ref="containerRef"
        class="pert-canvas h-80 w-full rounded-2xl border border-slate-800 overflow-hidden"
      ></div>

      <!-- Tooltip -->
      <div
        v-if="tooltip"
        class="fixed z-50 rounded-lg border border-slate-700
               bg-slate-900/95 px-3 py-2 text-[11px] text-slate-100
               shadow-xl pointer-events-none"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >
        <div class="font-semibold text-xs mb-1">
          {{ tooltip.task.title }}
        </div>
        <div class="font-mono space-y-0.5">
          <div>Duration: {{ tooltip.task.duration }} min</div>
          <div>ES: {{ tooltip.task.es }} · EF: {{ tooltip.task.ef }}</div>
          <div>LS: {{ tooltip.task.ls }} · LF: {{ tooltip.task.lf }}</div>
          <div>Slack: {{ tooltip.task.slack }} min</div>
        </div>
      </div>

      <!-- Zoom controls -->
      <div
        class="absolute right-3 top-3 flex items-center gap-1
               rounded-full bg-slate-900/70 text-[11px]
               px-2 py-1 border border-slate-700
               shadow-lg shadow-black/40
               dark:bg-slate-900/80 dark:border-slate-700"
      >
        <button
          type="button"
          class="h-6 w-6 inline-flex items-center justify-center rounded-full
                 border border-slate-600/80
                 hover:bg-slate-800/80 active:scale-95 transition"
          @click="zoomOut"
        >
          –
        </button>
        <button
          type="button"
          class="h-6 w-6 inline-flex items-center justify-center rounded-full
                 border border-slate-600/80
                 hover:bg-slate-800/80 active:scale-95 transition"
          @click="zoomIn"
        >
          +
        </button>
        <button
          type="button"
          class="ml-1 px-2 h-6 rounded-full border border-slate-600/80
                 hover:bg-slate-800/80 active:scale-95 transition"
          @click="resetView"
        >
          Reset
        </button>
        <span class="ml-1 text-slate-300/90">{{ zoomPercent }}%</span>
      </div>
    </div>

    <!-- Legend -->
    <div class="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-4">
      <span class="inline-flex items-center gap-1">
        <span
          class="inline-block h-3 w-3 rounded-full
                 border border-rose-500
                 bg-rose-300/60 dark:bg-rose-500/40"
        ></span>
        Critical tasks (slack = 0)
      </span>
      <span class="inline-flex items-center gap-1">
        <span
          class="inline-block h-3 w-3 rounded-full
                 border border-slate-400
                 bg-slate-300/60 dark:border-slate-500 dark:bg-slate-700/60"
        ></span>
        Non-critical
      </span>
      <span class="ml-auto">
        Zoom with wheel · Drag to pan
      </span>
    </div>
  </div>
</template>



<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'

type PertTask = {
  id: number
  title: string
  duration: number
  dependsOn: number | null
  es: number
  ef: number
  ls: number
  lf: number
  slack: number
}

const props = defineProps<{
  tasks: PertTask[]
  projectDuration: number
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let cy: Core | null = null

const zoomPercent = ref(100)
const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.2

const tooltip = ref<{
  x: number
  y: number
  task: PertTask
} | null>(null)

// --- thème courant (html.dark)
const isDark = ref<boolean>(
  document.documentElement.classList.contains('dark')
)

let themeObserver: MutationObserver | null = null

function getStyles(dark: boolean) {
  if (dark) {
    // PALETTE DARK
    return [
      {
        selector: 'node',
        style: {
          shape: 'round-rectangle',
          'background-color': '#020617',
          'border-width': 1,
          'border-color': '#cbd5f5',
          label: 'data(label)',
          'font-size': 9,
          'font-family':
            'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          'text-wrap': 'wrap',
          'text-max-width': 120,
          'text-valign': 'center',
          'text-halign': 'center',
          color: '#f9fafb',
          padding: '6px',
          'min-width': 120,
          'min-height': 70,
        },
      },
      {
        // critical path
        selector: 'node[slack = 0]',
        style: {
          'border-color': '#fb7185',
          'background-color': '#450a0a',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.6,
          'curve-style': 'bezier',
          'line-color': '#64748b',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#64748b',
          'arrow-scale': 0.8,
        },
      },
      {
        selector: 'edge.highlighted',
        style: {
          'line-color': '#a855f7',
          'target-arrow-color': '#a855f7',
          width: 2,
        },
      },
    ]
  }

  // PALETTE LIGHT
  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        'background-color': '#ffffff',
        'border-width': 1,
        'border-color': '#c4b5fd', // violet doux
        label: 'data(label)',
        'font-size': 9,
        'font-family':
          'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        'text-wrap': 'wrap',
        'text-max-width': 120,
        'text-valign': 'center',
        'text-halign': 'center',
        color: '#111827',
        padding: '6px',
        'min-width': 120,
        'min-height': 70,
      },
    },
    {
      selector: 'node[slack = 0]',
      style: {
        'border-color': '#f97373',
        'background-color': '#fee2e2',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.6,
        'curve-style': 'bezier',
        'line-color': '#9ca3af',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#9ca3af',
        'arrow-scale': 0.8,
      },
    },
    {
      selector: 'edge.highlighted',
      style: {
        'line-color': '#7c3aed',
        'target-arrow-color': '#7c3aed',
        width: 2,
      },
    },
  ]
}

function buildElements(): ElementDefinition[] {
  const elements: ElementDefinition[] = []

  for (const t of props.tasks) {
    elements.push({
      data: {
        id: String(t.id),
        label: `${t.title}\n${t.duration} min\nES:${t.es} EF:${t.ef}\nLS:${t.ls} LF:${t.lf}`,
        slack: t.slack,
      },
    })

    if (t.dependsOn != null) {
      elements.push({
        data: {
          id: `${t.dependsOn}->${t.id}`,
          source: String(t.dependsOn),
          target: String(t.id),
        },
      })
    }
  }

  return elements
}

function runLayout() {
  if (!cy) return
  cy
    .layout({
      name: 'breadthfirst',
      directed: true,
      padding: 40,
      spacingFactor: 1.25,
      animate: true,
      animationDuration: 300,
    })
    .run()
}

function initCy() {
  if (!containerRef.value) return

  cy = cytoscape({
    container: containerRef.value,
    elements: buildElements(),
    layout: {
      name: 'breadthfirst',
      directed: true,
      padding: 40,
      spacingFactor: 1.25,
    },
    style: getStyles(isDark.value),
  })

  cy.on('mouseover', 'node', (e) => {
    e.target.connectedEdges().addClass('highlighted')

    const id = Number(e.target.id())
    const task = props.tasks.find((t) => t.id === id)
    if (!task || !containerRef.value) return

    const rect = containerRef.value.getBoundingClientRect()
    const pos = e.target.renderedPosition()

    tooltip.value = {
      task,
      x: rect.left + pos.x + 12,  // little offset so we don't cover the node
      y: rect.top + pos.y + 12,
    }
  })

  cy.on('mouseout', 'node', (e) => {
    e.target.connectedEdges().removeClass('highlighted')
    tooltip.value = null
  })

  cy.ready(() => {
    cy!.fit(undefined, 40)
    let z = cy!.zoom()
    if (z < MIN_ZOOM) z = MIN_ZOOM
    if (z > MAX_ZOOM) z = MAX_ZOOM
    cy!.zoom(z)
    zoomPercent.value = Math.round(z * 100)
  })
}


function applyThemeToCy() {
  if (!cy) return
  cy.style().fromJson(getStyles(isDark.value)).update()
}

function applyZoom(factor: number) {
  if (!cy) return
  const current = cy.zoom()
  let next = current * factor
  next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))

  cy.zoom({
    level: next,
    position: { x: cy.width() / 2, y: cy.height() / 2 },
  })

  zoomPercent.value = Math.round(next * 100)
}

function zoomIn() {
  applyZoom(1.15)
}
function zoomOut() {
  applyZoom(0.85)
}
function resetView() {
  if (!cy) return
  cy.fit(undefined, 40)
  let z = cy.zoom()
  if (z < MIN_ZOOM) z = MIN_ZOOM
  if (z > MAX_ZOOM) z = MAX_ZOOM
  cy.zoom(z)
  zoomPercent.value = Math.round(z * 100)
}

onMounted(() => {
  if (props.tasks.length) initCy()

  // observe changement de classe .dark sur <html>
  themeObserver = new MutationObserver(() => {
    const nowDark = document.documentElement.classList.contains('dark')
    if (nowDark !== isDark.value) {
      isDark.value = nowDark
      applyThemeToCy()
    }
  })

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

onBeforeUnmount(() => {
  if (cy) {
    cy.destroy()
    cy = null
  }
  if (themeObserver) {
    themeObserver.disconnect()
    themeObserver = null
  }
})

watch(
  () => props.tasks,
  () => {
    if (!cy) {
      if (props.tasks.length) initCy()
      return
    }
    cy.elements().remove()
    cy.add(buildElements())
    runLayout()
    resetView()
  },
  { deep: true }
)
</script>


<style scoped>
/* fond + grille en LIGHT mode */
.pert-canvas {
  background-color: rgba(248, 250, 252, 0.9); /* slate-50-ish */
  background-image:
    linear-gradient(to right, rgba(148, 163, 184, 0.35) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(148, 163, 184, 0.35) 1px, transparent 1px);
  background-size: 32px 32px;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  border-radius: 1rem;
}
</style>

<!-- variant DARK, non scoped pour être sûr que ça tape bien html.dark -->
<style>
html.dark .pert-canvas {
  background-color: rgba(15, 23, 42, 0.9); /* slate-900 avec alpha */
  background-image:
    linear-gradient(to right, rgba(51, 65, 85, 0.6) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(51, 65, 85, 0.6) 1px, transparent 1px);
  background-size: 32px 32px;
}
</style>
