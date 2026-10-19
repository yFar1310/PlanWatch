import type { ApiProblem } from '../shared/tasks';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(method === 'GET' ? 'Could not connect. Check your connection and try refreshing.' : 'Could not confirm this change. Refresh to check it before trying again.');
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new ApiError('Sign in again to load and save tasks. Your drafts are kept on this device.', 401);
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    if (response.status === 401) throw new ApiError('Sign in again to load and save tasks.', 401);
    if (response.status === 403) throw new ApiError('This account does not have access to this workspace. Sign in with your allowed account.', 403);
    if (response.ok && response.headers.get('Content-Type')?.includes('text/html')) throw new ApiError('Sign in again to continue.', 401);
    throw new ApiError('The server is temporarily unavailable. Please try again.', response.status || 502);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError((data as ApiProblem | null)?.message ?? 'The request failed. Please try again.', response.status);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('The response could not be read. Please refresh and try again.', 502);
  return data as T;
}
