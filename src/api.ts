import type { ApiProblem } from '../shared/tasks';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(method === 'GET' ? 'Could not connect. Check your connection and try refreshing.' : 'Could not confirm this change. Refresh to check it before trying again.');
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError((data as ApiProblem | null)?.message ?? 'The request failed. Please try again.', response.status);
  return data as T;
}
