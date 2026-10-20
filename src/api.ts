import type { ApiProblem } from '../shared/tasks';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

let tokenProvider: (() => Promise<string | null>) | null = null;
let authGeneration = 0;
let apiBaseUrl = '/api';
export function setApiBaseUrl(value: string) {
  if (!value || value === '/api') { apiBaseUrl = '/api'; return; }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/api', '/api/'].includes(url.pathname)) {
    throw new Error('Configure an HTTPS API URL ending in /api.');
  }
  apiBaseUrl = `${url.origin}/api`;
}
// Clerk owns token refresh/storage. The API client never persists a bearer or replays a write.
export function setAuthTokenProvider(provider: (() => Promise<string | null>) | null) {
  tokenProvider = provider;
  ++authGeneration;
}

export async function api<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const generation = authGeneration;
  let token: string | null = null;
  if (tokenProvider) {
    try { token = await tokenProvider(); }
    catch { throw new ApiError('Could not verify your session. Reconnect and try again. Your drafts are kept on this device.', 401); }
    if (!token) throw new ApiError('Sign in again to load and save tasks. Your drafts are kept on this device.', 401);
  }
  if (generation !== authGeneration) throw new ApiError('Your account changed. Refresh before continuing.', 401);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      credentials: apiBaseUrl.startsWith('https://') ? 'omit' : 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(method === 'GET' ? 'Could not connect. Check your connection and try refreshing.' : 'Could not confirm this change. Refresh to check it before trying again.');
  }
  if (generation !== authGeneration) throw new ApiError('Your account changed. Refresh to check any pending change.', 401);
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
  if (generation !== authGeneration) throw new ApiError('Your account changed. Refresh to check any pending change.', 401);
  if (!response.ok) throw new ApiError((data as ApiProblem | null)?.message ?? 'The request failed. Please try again.', response.status, (data as ApiProblem | null)?.error);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('The response could not be read. Please refresh and try again.', 502);
  return data as T;
}
