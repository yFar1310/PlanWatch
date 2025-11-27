<template>
  <div class="space-y-2">
    <div
      ref="containerRef"
      class="pert-canvas h-80 w-full rounded-2xl border border-slate-800 overflow-hidden"
    ></div>

    <div class="text-[11px] text-slate-400 flex flex-wrap gap-4">
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-3 rounded-full border border-rose-500 bg-rose-500/30"></span>
        Critical tasks (slack = 0)
      </span>
      <span class="inline-flex items-center gap-1">
        <span class="inline-block h-3 w-3 rounded-full border border-slate-500 bg-slate-700/50"></span>
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
    cy.layout({
      name: 'breadthfirst',
      directed: true,
      padding: 30,
      spacingFactor: 1.3,
      animate: true,
      animationDuration: 300,
    }).run()
  }
  
  function initCy() {
    if (!containerRef.value) return
  
    cy = cytoscape({
      container: containerRef.value,
      elements: buildElements(),
      layout: {
        name: 'breadthfirst',
        directed: true,
        padding: 30,
        spacingFactor: 1.3,
      },
      style: [
        {
          selector: 'node',
          style: {
            'shape': 'round-rectangle',
            'background-color': '#020617',
            'border-width': 1,
            'border-color': '#64748b',
            'label': 'data(label)',
            'font-size': 9,
            'font-family': 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            'text-wrap': 'wrap',
            'text-max-width': 120,
            'text-valign': 'center',
            'text-halign': 'center',
            'color': '#e5e7eb',
            'padding': '6px',
            'min-width': 120,
            'min-height': 70,
            'shadow-blur': 16,
            'shadow-color': '#020617',
            'shadow-opacity': 0.8,
            'shadow-offset-x': 0,
            'shadow-offset-y': 8,
          },
        },
        {
          selector: 'node[slack = 0]',
          style: {
            'border-color': '#fb7185',
            'background-color': '#450a0a',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
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
            'width': 2,
          },
        },
      ],
    })
  
    // petit highlight au survol
    cy.on('mouseover', 'node', (e) => {
      const node = e.target
      node.connectedEdges().addClass('highlighted')
    })
    cy.on('mouseout', 'node', (e) => {
      const node = e.target
      node.connectedEdges().removeClass('highlighted')
    })
  }
  
  onMounted(() => {
    if (props.tasks.length) {
      initCy()
    }
  })
  
  onBeforeUnmount(() => {
    if (cy) {
      cy.destroy()
      cy = null
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
    },
    { deep: true }
  )
  </script>
<style scoped>
.pert-canvas {
  /* fond de base */
  background-color: #020617;

  /* vignette douce pour donner une profondeur */
  background-image:
    radial-gradient(circle at 0 0, rgba(56, 189, 248, 0.08), transparent 55%),
    radial-gradient(circle at 100% 100%, rgba(168, 85, 247, 0.08), transparent 55%),
    linear-gradient(to right, rgba(51, 65, 85, 0.4) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(51, 65, 85, 0.4) 1px, transparent 1px);

  /* taille de la grille (32px comme un carreau de cahier un peu grand) */
  background-size:
    100% 100%,
    100% 100%,
    32px 32px,
    32px 32px;

  /* léger blur pour que ça fasse “papier” et pas “Excel” */
  backdrop-filter: blur(2px);
}
</style>