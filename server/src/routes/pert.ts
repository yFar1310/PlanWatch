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

export default async function pertHandler(c: Context) {
  const { rows } = await pool.query(`
    SELECT
      id,
      title,
      expected_minutes AS "duration",
      depends_on       AS "dependsOn"
    FROM plans
  `)

  const nodes: Node[] = rows.map((r: any) => ({
    id: Number(r.id),
    title: r.title,
    duration: Number(r.duration) || 0,
    dependsOn: r.dependsOn != null ? Number(r.dependsOn) : null,
  }))

  if (!nodes.length) return c.json({ projectDuration: 0, tasks: [] })

  // maps
  const byId = new Map<number, Node>()
  const preds = new Map<number, number[]>()  // prédécesseurs
  const succs = new Map<number, number[]>()  // successeurs
  const indeg = new Map<number, number>()

  for (const n of nodes) {
    byId.set(n.id, n)
    preds.set(n.id, [])
    succs.set(n.id, [])
    indeg.set(n.id, 0)
  }

  // construit graphe
  for (const n of nodes) {
    if (n.dependsOn != null && byId.has(n.dependsOn)) {
      preds.get(n.id)!.push(n.dependsOn)
      succs.get(n.dependsOn)!.push(n.id)
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1)
    }
  }

  // tri topologique (Kahn)
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
    // cycle détecté
    return c.json(
      { ok: false, error: 'cycle_detected', message: 'Dependency graph contains a cycle.' },
      400,
    )
  }

  // FORWARD PASS : ES / EF
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

  // BACKWARD PASS : LS / LF
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
