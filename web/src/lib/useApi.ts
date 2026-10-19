// web/src/lib/useApi.ts
import type { Plan, DashboardStats, ActivityEvent, PlanStatus, User } from '../types';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000') as string;

type LoginResponse = {
  ok: boolean;
  token: string;
  user: User;
};

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});

  // JSON par défaut si body
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // JWT si présent (sauf pour les routes d'auth)
  const token = localStorage.getItem('pw.token');
  const isAuthRoute =
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/signup');

  if (token && !isAuthRoute) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('Could not connect. Your changes have not been confirmed. Check your connection and refresh before trying again.');
  }

  // 401 -> on nettoie et on renvoie vers /login (sauf si déjà dessus)
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    localStorage.removeItem('pw.token');
    localStorage.removeItem('pw.user');
    if (location.pathname !== '/login') {
      location.href = '/login';
    }
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const fieldIssue = data?.issues?.[0];
    const msg = fieldIssue
      ? `${fieldIssue.path?.join(' ') || 'Task'}: ${fieldIssue.message}`
      : data?.message || ({
          unauthorized: 'Your session has expired. Please sign in again.',
          not_found: 'This task is no longer available. Refresh your task list.',
          invalid_credentials: 'The email or password is incorrect.',
          internal: 'Something went wrong. Please try again.',
        } as Record<string, string>)[data?.error] || `Could not complete the request (${res.status}). Please try again.`;
    throw new Error(msg);
  }

  return data as T;
}

export function useApi() {
  return {
    // --- Auth ---------------------------------------------------------------
    signup(email: string, password: string, fullName?: string) {
      return request<LoginResponse>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName }),
      });
    },

    login(email: string, password: string) {
      return request<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },

    getMe() {
      return request<{ ok: boolean; user: User }>('/api/auth/me');
    },

    updateProfile(payload: { fullName?: string; avatarData?: string | null }) {
      return request<{ ok: boolean; user: User }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },

    // --- Plans --------------------------------------------------------------
    submitPlan(payload: Plan) {
      return request<{ ok: boolean; plan: Plan }>('/api/submit', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    listPlans(params?: {
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
      order?: 'due_at' | 'created_at';
      dir?: 'asc' | 'desc';
      projectId?: number;
      status?: PlanStatus;
      search?: string;
    }) {
      const qs = params
        ? '?' + new URLSearchParams(params as any).toString()
        : '';
      return request<{ items: Plan[] }>(`/api/plans${qs}`);
    },

    getPlan(id: number) {
      return request<{ plan: Plan }>(`/api/plans/${id}`);
    },

    updatePlan(id: number, patch: Partial<Plan>) {
      return request<{ ok: boolean; plan: Plan }>(`/api/plans/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },

    deletePlan(id: number) {
      return request<{ ok: boolean }>(`/api/plans/${id}`, {
        method: 'DELETE',
      });
    },

    // --- Dashboard ---------------------------------------------------------
    getStats() {
      return request<DashboardStats>('/api/stats');
    },

    listActivity(options?: { limit?: number; before?: string }) {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.before) params.set('before', options.before);

      const qs = params.toString() ? `?${params.toString()}` : '';
      return request<{ items: ActivityEvent[]; nextCursor?: string | null }>(
        `/api/activity${qs}`,
      );
    },

    pert() {
      return request('/api/pert');
    },

    // --- Activity export (PDF) ---------------------------------------------
    async downloadActivityPdf() {
      const path = '/api/activity/export';
      const headers = new Headers();

      const token = localStorage.getItem('pw.token');
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const res = await fetch(`${BASE}${path}`, { headers });

      if (res.status === 401) {
        localStorage.removeItem('pw.token');
        localStorage.removeItem('pw.user');
        if (location.pathname !== '/login') {
          location.href = '/login';
        }
        throw new Error('unauthorized');
      }

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'planwatch-activity.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  };
}
