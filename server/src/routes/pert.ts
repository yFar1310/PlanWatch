// server/src/routes/pert.ts
import type { Context } from 'hono'
import { pool } from '../db/pg.js'

type Node = {
  id: number
  title: string
  duration: number
  dependsOn: number | null
}

type PertTask = Node & {
  es: number
  ef: number
  ls: number
  lf: number
  slack: number
}

// Helper commun : PG INT[] / string -> premier id ou null
function parseDepends(raw: unknown): number | null {
  if (raw == null) return null

  if (Array.isArray(raw)) {
    if (!raw.length) return null
    const n = Number(raw[0])
    return Number.isFinite(n) && n > 0 ? n : null
  }

  if (typeof raw === 'string') {
    const trimmed = raw.replace(/[{}]/g, '').trim()
    if (!trimmed) return null
    const first = trimmed.split(',')[0]
    const n = Number(first)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export default async function pertHandler(c: Context) {
  const { rows } = await pool.query(`
    SELECT
      id,
      title,
      expected_minutes AS "duration",
      depends_on       AS "dependsOn",
      due_at
    FROM plans
    WHERE status = 'active'
    ORDER BY due_at ASC
    LIMIT 15
  `)

  const rawNodes: Node[] = rows
    .map((r: any) => ({
      id: Number(r.id),
      title: r.title as string,
      duration: Number(r.duration) || 0,
      dependsOn: parseDepends(r.dependsOn),
    }))
    .filter((n) => n.duration > 0)

  if (!rawNodes.length) {
    return c.json({ projectDuration: 0, tasks: [] })
  }

  // On ignore les deps vers des tâches hors du batch
  const idSet = new Set(rawNodes.map((n) => n.id))

  const nodes: Node[] = rawNodes.map((n) => ({
    ...n,
    dependsOn:
      n.dependsOn != null && idSet.has(n.dependsOn) ? n.dependsOn : null,
  }))

  // --- build graph
  const byId = new Map<number, Node>()
  const preds = new Map<number, number[]>()
  const succs = new Map<number, number[]>()
  const indeg = new Map<number, number>()

  for (const n of nodes) {
    byId.set(n.id, n)
    preds.set(n.id, [])
    succs.set(n.id, [])
    indeg.set(n.id, 0)
  }

  for (const n of nodes) {
    if (n.dependsOn != null && byId.has(n.dependsOn)) {
      preds.get(n.id)!.push(n.dependsOn)
      succs.get(n.dependsOn)!.push(n.id)
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1)
    }
  }

  // --- topological sort (Kahn)
  const queue: number[] = []
  for (const [id, d] of indeg.entries()) {
    if (d === 0) queue.push(id)
  }

  const topoOrder: number[] = []
  while (queue.length) {
    const id = queue.shift()!
    topoOrder.push(id)
    for (const s of succs.get(id) ?? []) {
      indeg.set(s, (indeg.get(s) ?? 0) - 1)
      if (indeg.get(s) === 0) queue.push(s)
    }
  }

  if (topoOrder.length !== nodes.length) {
    return c.json(
      {
        ok: false,
        error: 'cycle_detected',
        message: 'Dependency graph contains a cycle.',
      },
      400,
    )
  }

  // --- forward pass ES / EF
  const es = new Map<number, number>()
  const ef = new Map<number, number>()

  for (const id of topoOrder) {
    const n = byId.get(id)!
    const pIds = preds.get(id) ?? []

    let esVal = 0
    if (pIds.length) {
      esVal = Math.max(...pIds.map((p) => ef.get(p) ?? 0))
    }
    const efVal = esVal + n.duration

    es.set(id, esVal)
    ef.set(id, efVal)
  }

  const projectDuration = Math.max(...Array.from(ef.values()))

  // --- backward pass LS / LF
  const ls = new Map<number, number>()
  const lf = new Map<number, number>()

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i]
    const n = byId.get(id)!
    const succIds = succs.get(id) ?? []

    let lfVal: number
    if (!succIds.length) {
      lfVal = projectDuration
    } else {
      lfVal = Math.min(...succIds.map((s) => ls.get(s)!))
    }
    const lsVal = lfVal - n.duration

    lf.set(id, lfVal)
    ls.set(id, lsVal)
  }

  const tasks: PertTask[] = nodes.map((n) => ({
    ...n,
    es: es.get(n.id)!,
    ef: ef.get(n.id)!,
    ls: ls.get(n.id)!,
    lf: lf.get(n.id)!,
    slack: ls.get(n.id)! - es.get(n.id)!,
  }))

  return c.json({ projectDuration, tasks })
}
