import type { Plan, DashboardStats, ActivityEvent } from '../types'


const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000') as string


async function json(r: Response) {
const j = await r.json()
if (!r.ok) throw new Error(j?.message || r.statusText)
return j
}


export function useApi() {
return {
submitPlan(payload: Plan) {
return fetch(`${BASE}/api/submit`, {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload),
}).then(json)
},
listPlans(params?: { from?: string; to?: string; limit?: number; offset?: number; order?: 'due_at'|'created_at'; dir?: 'asc'|'desc' }) {
  const qs = params ? '?' + new URLSearchParams(params as any).toString() : '';
  return fetch(`${BASE}/api/plans${qs}`).then(json);
},
getPlan(id: number) {
  return fetch(`${BASE}/api/plans/${id}`).then(json)
},
updatePlan(id: number, patch: Partial<Plan>) {
  return fetch(`${BASE}/api/plans/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(patch),
  }).then(json)
},
deletePlan(id: number) {
  return fetch(`${BASE}/api/plans/${id}`, { method: 'DELETE' }).then(json)
},
getStats() {
  return fetch(`${BASE}/api/stats`).then(json) as Promise<DashboardStats>
},
listActivity(limit = 8) {
  const qs = `?limit=${limit}`
  return fetch(`${BASE}/api/activity${qs}`).then(json) as Promise<{ items: ActivityEvent[] }>
},
pert() {
  return fetch(`${BASE}/api/pert`).then(json)
},
}
}