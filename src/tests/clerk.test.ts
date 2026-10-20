import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { Ref } from 'vue';
import ClerkGate from '../ClerkGate.vue';
import Root from '../Root.vue';
import { api } from '../api';
import { capture } from '../drafts';
import { currentDay } from '../../shared/calendar';

const auth = vi.hoisted(() => ({
  isLoaded: undefined as unknown as Ref<boolean>, isSignedIn: undefined as unknown as Ref<boolean>,
  userId: undefined as unknown as Ref<string | null>, sessionId: undefined as unknown as Ref<string | null>,
  getToken: vi.fn(), signOut: vi.fn(),
}));
vi.mock('../auth-config', () => ({ clerkEnabled: false, localPreview: false }));
vi.mock('@clerk/vue', async () => {
  const { ref, h } = await import('vue');
  auth.isLoaded = ref(false); auth.isSignedIn = ref(false);
  auth.userId = ref(null); auth.sessionId = ref(null);
  return {
    useAuth: () => ({ ...auth, getToken: ref(auth.getToken) }),
    useClerk: () => ref({ signOut: auth.signOut }),
    SignIn: { setup: () => () => h('div', { 'data-testid': 'clerk-signin' }, 'Secure sign-in') },
  };
});

let wrapper: VueWrapper | undefined;
const fetchMock = vi.fn();
let sessionExpires: number;
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function signedIn(id = 'user_Owner') {
  auth.isLoaded.value = true; auth.isSignedIn.value = true; auth.userId.value = id; auth.sessionId.value = 'sess_Current';
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', fetchMock);
  auth.isLoaded.value = false; auth.isSignedIn.value = false; auth.userId.value = null; auth.sessionId.value = null;
  auth.getToken.mockReset().mockResolvedValue('current-clerk-session');
  auth.signOut.mockReset().mockResolvedValue(undefined);
  capture.value = { title: '', plannedDate: '', key: null, payload: null };
  sessionExpires = Date.now() + 60_000;
  fetchMock.mockReset().mockImplementation(async (path: string) => path === '/api/session'
    ? json({ mode: 'clerk', email: null, expiresAt: sessionExpires })
    : json({ items: [{ id: 'task-one', title: 'Private owner task', status: 'todo', version: 1, plannedDate: currentDay(), notes: null }], nextCursor: null }));
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Clerk sign-in and task workspace boundary', () => {
  it('keeps an unconfigured hosted frontend closed without requesting the database', async () => {
    wrapper = mount(Root); await flushPromises();
    expect(wrapper.text()).toContain('Sign-in is being prepared');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="New task title"]').exists()).toBe(false);
  });
  it('never requests tasks while loading or signed out', async () => {
    wrapper = mount(ClerkGate);
    await flushPromises();
    expect(wrapper.text()).toContain('Preparing secure sign-in');
    expect(fetchMock).not.toHaveBeenCalled();
    auth.isLoaded.value = true;
    await flushPromises();
    expect(wrapper.find('[data-testid="clerk-signin"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="New task title"]').exists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('loads the signed-in workspace with Clerk bearer tokens', async () => {
    signedIn(); wrapper = mount(ClerkGate); await flushPromises();
    expect(wrapper.text()).toContain('Private owner task');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/session', expect.stringContaining('/api/tasks?')]);
    expect(fetchMock.mock.calls.every(([, options]) => options.headers.Authorization === 'Bearer current-clerk-session')).toBe(true);
  });
  it('enables Add task after a title is entered and prevents a second submission while saving', async () => {
    signedIn();
    let finishSave!: (response: Response) => void;
    const task = { id: 'new-task', title: 'Walk outside', status: 'todo', version: 1, plannedDate: null, notes: null };
    let saved = false;
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (path === '/api/session') return Promise.resolve(json({ mode: 'clerk', email: null, expiresAt: sessionExpires }));
      if (options.method === 'POST') return new Promise<Response>(resolve => { finishSave = response => { saved = true; resolve(response); }; });
      return Promise.resolve(json({ items: saved ? [task] : [], nextCursor: null }));
    });
    wrapper = mount(ClerkGate); await flushPromises();
    const add = wrapper.get<HTMLButtonElement>('button[type="submit"]');
    expect(add.element.disabled).toBe(true);
    await wrapper.get('[aria-label="New task title"]').setValue('Walk outside');
    expect(add.element.disabled).toBe(false);
    await wrapper.get('form.capture').trigger('submit'); await flushPromises();
    expect(add.element.disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    finishSave(json({ task }, 201)); await flushPromises();
    expect(wrapper.text()).toContain('Walk outside');
    expect(wrapper.get<HTMLInputElement>('[aria-label="New task title"]').element.value).toBe('');
    expect(add.element.disabled).toBe(true);
  });
  it('allows capture once authenticated even while the task list is still loading', async () => {
    signedIn();
    fetchMock.mockImplementation((path: string) => path === '/api/session'
      ? Promise.resolve(json({ mode: 'clerk', email: null, expiresAt: sessionExpires }))
      : new Promise(() => {}));
    wrapper = mount(ClerkGate); await flushPromises();
    expect(wrapper.text()).toContain('Loading your tasks');
    await wrapper.get('[aria-label="New task title"]').setValue('Capture without waiting');
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(false);
  });
  it('hides private records immediately when Clerk reports sign-out', async () => {
    signedIn(); wrapper = mount(ClerkGate); await flushPromises();
    auth.isSignedIn.value = false; auth.userId.value = null; auth.sessionId.value = null;
    await flushPromises();
    expect(wrapper.text()).not.toContain('Private owner task');
    expect(wrapper.find('[data-testid="clerk-signin"]').exists()).toBe(true);
    await expect(api('/tasks', 'POST', { title: 'Must not save' })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps drafts and hides records while an explicit sign-out is pending', async () => {
    signedIn(); auth.signOut.mockImplementation(() => new Promise(() => {}));
    wrapper = mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="New task title"]').setValue('A draft to keep');
    await wrapper.get('[aria-label="Sign out"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).not.toContain('Private owner task');
    expect(wrapper.text()).toContain('Signing out');
    expect(capture.value.title).toBe('A draft to keep');
    expect(auth.signOut).toHaveBeenCalledWith({ redirectUrl: '/' });
    await expect(api('/tasks')).rejects.toMatchObject({ status: 401 });
  });
  it('keeps content hidden when sign-out fails and offers a retry', async () => {
    signedIn(); auth.signOut.mockRejectedValue(new Error('Offline'));
    wrapper = mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="Sign out"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).not.toContain('Private owner task');
    expect(wrapper.text()).toContain('Sign-out could not be confirmed');
    expect(wrapper.text()).toContain('Try signing out again');
  });
  it('renews a short-lived token without removing tasks or drafts', async () => {
    signedIn(); wrapper = mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="New task title"]').setValue('Keep my focus');
    auth.getToken.mockResolvedValue('renewed-clerk-session');
    sessionExpires = Date.now() + 120_000;
    await vi.advanceTimersByTimeAsync(30_000); await flushPromises();
    expect(wrapper.text()).toContain('Private owner task');
    expect(wrapper.get<HTMLInputElement>('[aria-label="New task title"]').element.value).toBe('Keep my focus');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Bearer renewed-clerk-session');
  });
  it('denies another account before loading tasks and provides a way to switch accounts', async () => {
    signedIn('user_Other');
    fetchMock.mockResolvedValue(json({ error: 'not_allowed', message: 'This account does not have access to this workspace.' }, 403));
    wrapper = mount(ClerkGate); await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('Private owner task');
    expect(wrapper.text()).toContain('Switch account');
    expect(wrapper.text()).toContain('user_Other');
  });
  it('cannot repopulate tasks from a delayed response after session verification fails', async () => {
    signedIn();
    let finishTasks!: (response: Response) => void;
    let sessionChecks = 0;
    fetchMock.mockImplementation((path: string) => path === '/api/session'
      ? Promise.resolve(++sessionChecks === 1 ? json({ mode: 'clerk', email: null, expiresAt: Date.now() + 60_000 }) : json({ error: 'invalid_session', message: 'Sign in again.' }, 401))
      : new Promise<Response>(resolve => { finishTasks = resolve; }));
    wrapper = mount(ClerkGate); await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000); await flushPromises();
    finishTasks(json({ items: [{ id: 'late-task', title: 'Late private record' }], nextCursor: null }));
    await flushPromises();
    expect(wrapper.text()).toContain('Sign in again.');
    expect(wrapper.text()).not.toContain('Late private record');
    expect(wrapper.find('[aria-label="New task title"]').exists()).toBe(false);
  });
  it('shows a recovery action if the external sign-in script cannot finish loading', async () => {
    wrapper = mount(ClerkGate);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(wrapper.text()).toContain('Check your connection');
    expect(wrapper.text()).toContain('Reload sign-in');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
