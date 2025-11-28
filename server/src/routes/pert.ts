// server/src/routes/pert.ts
import type { Context } from 'hono'
import { pool } from '../db/pg.js'

type NodeRow = {
  id: number
  title: string
  duration: number
  dependsOn: number | null
}

type PertTask = NodeRow & {
  es: number
  ef: number
  ls: number
  lf: number
  slack: number
}

export default async function pertHandler(c: Context) {
  try {
    const { rows } = await pool.query<NodeRow>(
      `
      SELECT
        id,
        title,
        expected_minutes AS "duration",
        depends_on       AS "dependsOn"
      FROM plans
      ORDER BY id ASC
      `
    )

    // Aucun plan → rien à dessiner
    if (!rows.length) {
      return c.json({ tasks: [] as PertTask[], projectDuration: 0 })
    }

    // on garde seulement ceux qui ont une durée > 0
    const nodes = rows.filter((r) => r.duration != null && r.duration > 0)
    if (!nodes.length) {
      return c.json({ tasks: [] as PertTask[], projectDuration: 0 })
    }

    const byId = new Map<number, NodeRow>()
    for (const n of nodes) {
      byId.set(n.id, n)
    }

    // enfants (pour le backward pass)
    const children = new Map<number, number[]>()
    for (const n of nodes) {
      if (n.dependsOn != null && byId.has(n.dependsOn)) {
        const arr = children.get(n.dependsOn) ?? []
        arr.push(n.id)
        children.set(n.dependsOn, arr)
      }
    }

    // forward pass : ES / EF
    const es = new Map<number, number>()
    const ef = new Map<number, number>()
    const visiting = new Set<number>() // sécurité anti-cycle

    function computeForward(id: number) {
      if (ef.has(id)) return
      if (visiting.has(id)) {
        // cycle improbable → on met tout à 0 pour ce nœud
        const n = byId.get(id)
        const dur = n?.duration ?? 0
        es.set(id, 0)
        ef.set(id, dur)
        return
      }

      const n = byId.get(id)
      if (!n) return

      visiting.add(id)
      let start = 0

      if (n.dependsOn != null && byId.has(n.dependsOn)) {
        computeForward(n.dependsOn)
        start = ef.get(n.dependsOn) ?? 0
      }

      es.set(id, start)
      ef.set(id, start + n.duration)
      visiting.delete(id)
    }

    for (const n of nodes) {
      computeForward(n.id)
    }

    const projectDuration = Math.max(...Array.from(ef.values()))

    // backward pass : LS / LF
    const ls = new Map<number, number>()
    const lf = new Map<number, number>()

    // ordre topologique approximatif via ES croissant
    const ordered = [...nodes].sort(
      (a, b) => (es.get(a.id) ?? 0) - (es.get(b.id) ?? 0)
    )

    // init : tout le monde finit au plus tard à projectDuration
    for (const n of ordered) {
      lf.set(n.id, projectDuration)
    }

    // on remonte
    for (let i = ordered.length - 1; i >= 0; i--) {
      const n = ordered[i]
      const childs = children.get(n.id)

      if (childs && childs.length) {
        const minChildLs = Math.min(
          ...childs.map((cid) => ls.get(cid) ?? projectDuration)
        )
        lf.set(n.id, minChildLs)
      }

      const lfVal = lf.get(n.id) ?? projectDuration
      ls.set(n.id, lfVal - n.duration)
    }

    const tasks: PertTask[] = ordered.map((n) => {
      const esVal = es.get(n.id) ?? 0
      const efVal = ef.get(n.id) ?? n.duration
      const lsVal = ls.get(n.id) ?? esVal
      const lfVal = lf.get(n.id) ?? efVal
      const slack = lsVal - esVal

      return {
        id: n.id,
        title: n.title,
        duration: n.duration,
        dependsOn: n.dependsOn,
        es: esVal,
        ef: efVal,
        ls: lsVal,
        lf: lfVal,
        slack,
      }
    })

    return c.json({ tasks, projectDuration })
  } catch (e: any) {
    console.error('pert error', e)
    return c.json(
      { error: 'internal', message: e?.message ?? 'internal_error' },
      500
    )
  }
}
