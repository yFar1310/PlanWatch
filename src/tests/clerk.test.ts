import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { Ref } from 'vue';
import ClerkGate from '../ClerkGate.vue';
import Root from '../Root.vue';
import { api } from '../api';
import { activateDrafts, deactivateDrafts, capture } from '../drafts';
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
  deactivateDrafts(); localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', fetchMock);
  auth.isLoaded.value = false; auth.isSignedIn.value = false; auth.userId.value = null; auth.sessionId.value = null;
  auth.getToken.mockReset().mockResolvedValue('current-clerk-session');
  auth.signOut.mockReset().mockResolvedValue(undefined);
  capture.value = { priority: 'medium', dependsOn: null, title: '', plannedDate: '', key: null, payload: null };
  sessionExpires = Date.now() + 60_000;
  fetchMock.mockReset().mockImplementation(async (path: string) => path === '/api/session'
    ? json({ workspaceId: 'personal', displayName: 'Administrator', canAdmin: true, mode: 'clerk', email: null, expiresAt: sessionExpires })
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
    expect(fetchMock.mock.calls.filter(([path]) => path !== '/api/activity').map(([path]) => path)).toEqual(['/api/session', expect.stringContaining('/api/tasks?')]);
    expect(fetchMock.mock.calls.every(([, options]) => options.headers.Authorization === 'Bearer current-clerk-session')).toBe(true);
  });
  it('enables Add task after a title is entered and prevents a second submission while saving', async () => {
    signedIn();
    let finishSave!: (response: Response) => void;
    const task = { id: 'new-task', title: 'Walk outside', status: 'todo', version: 1, plannedDate: null, notes: null };
    let saved = false;
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (path === '/api/session') return Promise.resolve(json({ workspaceId: 'personal', displayName: 'Administrator', canAdmin: true, mode: 'clerk', email: null, expiresAt: sessionExpires }));
      if (path === '/api/activity') return Promise.resolve(json({ recorded: true }));
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
    expect(fetchMock.mock.calls.filter(([path, options]) => path !== '/api/activity' && options.method === 'POST')).toHaveLength(1);
    finishSave(json({ task }, 201)); await flushPromises();
    expect(wrapper.text()).toContain('Walk outside');
    expect(wrapper.get<HTMLInputElement>('[aria-label="New task title"]').element.value).toBe('');
    expect(add.element.disabled).toBe(true);
  });
  it('allows capture once authenticated even while the task list is still loading', async () => {
    signedIn();
    fetchMock.mockImplementation((path: string) => path === '/api/session'
      ? Promise.resolve(json({ workspaceId: 'personal', displayName: 'Administrator', canAdmin: true, mode: 'clerk', email: null, expiresAt: sessionExpires }))
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
    expect(fetchMock.mock.calls.filter(([path]) => path !== '/api/activity')).toHaveLength(2);
  });
  it('keeps drafts and hides records while an explicit sign-out is pending', async () => {
    signedIn(); auth.signOut.mockImplementation(() => new Promise(() => {}));
    wrapper = mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="New task title"]').setValue('A draft to keep');
    await wrapper.get('[aria-label="Sign out"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).not.toContain('Private owner task');
    expect(wrapper.text()).toContain('Signing out');
    expect(capture.value.title).toBe('');
    activateDrafts('personal');
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
      ? Promise.resolve(++sessionChecks === 1 ? json({ workspaceId: 'personal', displayName: 'Administrator', canAdmin: true, mode: 'clerk', email: null, expiresAt: Date.now() + 60_000 }) : json({ error: 'invalid_session', message: 'Sign in again.' }, 401))
      : path === '/api/activity' ? Promise.resolve(json({ recorded: true })) : new Promise<Response>(resolve => { finishTasks = resolve; }));
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

function button(text: string) { return wrapper!.findAll('button').find(item => item.text() === text)!; }
describe('invitations, administration and deliberate task actions', () => {
  it('shows enrollment without loading tasks and requires disclosure acknowledgment', async () => {
    signedIn('user_Friend');
    let joined=false;
    fetchMock.mockImplementation(async (path:string, options:RequestInit) => {
      if(path==='/api/session') return joined ? json({mode:'clerk',email:null,expiresAt:sessionExpires,workspaceId:'friend-space',displayName:'Friend',canAdmin:false}) : json({error:'invitation_required',message:'Invitation required.'},403);
      if(path==='/api/invitations/accept') { const body=JSON.parse(options.body as string); expect(body.usageAcknowledged).toBe(true); expect(body.displayName).toBe('Friend'); joined=true; return json({joined:true},201); }
      if(path==='/api/activity') return json({recorded:true});
      return json({items:[],nextCursor:null});
    });
    wrapper=mount(ClerkGate); await flushPromises();
    expect(wrapper.text()).toContain('administrator can see');
    expect(fetchMock.mock.calls.some(([path])=>path.includes('/tasks'))).toBe(false);
    const inputs=wrapper.findAll('.enrollment-form input');
    await inputs[0]!.setValue('Friend'); await inputs[1]!.setValue('a'.repeat(43));
    expect(button('Accept invitation').attributes('disabled')).toBeDefined();
    await inputs[2]!.setValue(true); await wrapper.get('.enrollment-form').trigger('submit'); await flushPromises();
    expect(wrapper.find('[aria-label="New task title"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Administration');
  });
  it('clears private content and drafts when a heartbeat discovers a ban', async () => {
    signedIn(); wrapper=mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="New task title"]').setValue('Private unsaved note');
    fetchMock.mockResolvedValue(json({error:'account_banned',message:'Access paused.'},403));
    await vi.advanceTimersByTimeAsync(30000); await flushPromises();
    expect(wrapper.text()).toContain('Access paused'); expect(wrapper.text()).not.toContain('Private owner task');
    expect(wrapper.find('[aria-label="New task title"]').exists()).toBe(false); expect(capture.value.title).toBe('');
    expect(wrapper.text()).not.toContain('Administration');
  });
  it('asks for confirmation before completing and cancels without a write', async () => {
    signedIn(); wrapper=mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="Complete Private owner task"]').trigger('click');
    expect(wrapper.get('dialog').text()).toContain('Done with this task?');
    expect(fetchMock.mock.calls.filter(([,options])=>options.method==='PATCH')).toHaveLength(0);
    await button('Keep working').trigger('click');
    expect(wrapper.find('dialog').exists()).toBe(false);
    await wrapper.get('[aria-label="Complete Private owner task"]').trigger('click');
    await button('Yes, mark as done').trigger('click'); await flushPromises();
    expect(fetchMock.mock.calls.filter(([,options])=>options.method==='PATCH')).toHaveLength(1);
    const change=fetchMock.mock.calls.find(([,options])=>options.method==='PATCH')!;
    expect(JSON.parse(change[1].body)).toEqual({version:1,status:'done'});
    expect(wrapper.find('dialog').exists()).toBe(false);
  });
  it('offers deletion for completed tasks and sends priority filters to the API', async () => {
    signedIn();
    fetchMock.mockImplementation(async (path:string,options:RequestInit) => {
      if(path==='/api/session') return json({mode:'clerk',email:null,expiresAt:sessionExpires,workspaceId:'personal',displayName:'Administrator',canAdmin:true});
      if(path==='/api/activity') return json({recorded:true});
      if(options.method==='DELETE') return json({task:{id:'done-task',title:'Finished task',status:'done',version:2,priority:'high'}});
      return json({items:[{id:'done-task',title:'Finished task',status:'done',version:1,priority:'high'}],nextCursor:null});
    });
    wrapper=mount(ClerkGate); await flushPromises();
    await wrapper.get('.priority-filter select').setValue('high');
    await vi.advanceTimersByTimeAsync(0); await flushPromises();
    expect(fetchMock.mock.calls.some(([path])=>path.includes('priority=high'))).toBe(true);
    await wrapper.get('[aria-label="Delete Finished task"]').trigger('click'); await flushPromises();
    expect(fetchMock.mock.calls.some(([path,options])=>path==='/api/tasks/done-task'&&options.method==='DELETE')).toBe(true);
    expect(wrapper.text()).toContain('Undo last delete');
  });
  it('allows only the administrator UI to generate invitations and confirm member bans', async () => {
    signedIn();
    const member={id:'friend-space',displayName:'Alex',status:'active',createdAt:Date.now(),version:1,isAdmin:false,lastSeenAt:Date.now(),sessions:2,activeMs:60000,tasks:3,completedTasks:1};
    fetchMock.mockImplementation(async (path:string,options:RequestInit) => {
      if(path==='/api/session') return json({mode:'clerk',email:null,expiresAt:sessionExpires,workspaceId:'personal',displayName:'Administrator',canAdmin:true});
      if(path==='/api/activity') return json({recorded:true});
      if(path.startsWith('/api/admin?')) return json({totals:{members:2,banned:0,recentlySeen:1,activeMs:60000,tasks:3},members:[member],nextCursor:null,invitations:[]});
      if(path==='/api/admin/invitations') return json({link:'https://example.test/#invite='+'a'.repeat(43)});
      if(path==='/api/admin/users/friend-space') { member.status='banned'; member.version++; return json({updated:true}); }
      return json({items:[],nextCursor:null});
    });
    wrapper=mount(ClerkGate); await flushPromises();
    await button('Administration').trigger('click'); await flushPromises();
    expect(wrapper.get('#admin-title').text()).toBe('Administration'); expect(wrapper.text()).toContain('Alex');
    expect(wrapper.find('[aria-label="New task title"]').exists()).toBe(false);
    await wrapper.get('.admin-form input').setValue('Alex invitation');
    await wrapper.get('.admin-form').trigger('submit'); await flushPromises();
    expect(wrapper.get<HTMLInputElement>('.invite-result input').element.value).toContain('#invite=');
    await button('Ban member').trigger('click');
    expect(fetchMock.mock.calls.some(([,options])=>options.method==='PATCH')).toBe(false);
    await button('Confirm ban').trigger('click'); await flushPromises();
    expect(button('Restore access').exists()).toBe(true);
    const change=fetchMock.mock.calls.find(([path])=>path==='/api/admin/users/friend-space')!;
    expect(JSON.parse(change[1].body)).toEqual({status:'banned',version:1});
  });
});

describe('completion from the details form', () => {
  it('also requires confirmation when status is changed through the editor', async () => {
    signedIn(); wrapper=mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="Edit Private owner task"]').trigger('click');
    const selects=wrapper.findAll('.task-details select');
    const statusSelect=selects.find(item=>item.find('option[value="done"]').exists())!;
    await statusSelect.setValue('done');
    await wrapper.get('form.task-details').trigger('submit'); await flushPromises();
    expect(wrapper.find('dialog').exists()).toBe(true);
    expect(fetchMock.mock.calls.filter(([,options])=>options.method==='PATCH')).toHaveLength(0);
    await button('Keep working').trigger('click');
    expect(wrapper.find('dialog').exists()).toBe(false);
    expect(wrapper.find('form.task-details').exists()).toBe(true);
  });
});

describe('capture retries across the priority migration', () => {
  it('preserves the request key for an unchanged legacy capture instead of creating a duplicate', async () => {
    signedIn(); wrapper=mount(ClerkGate); await flushPromises();
    const key=crypto.randomUUID();
    capture.value={title:'Unconfirmed task',plannedDate:'',priority:'medium',dependsOn:null,key,payload:JSON.stringify({title:'Unconfirmed task',plannedDate:null})};
    await wrapper.get('form.capture').trigger('submit'); await flushPromises();
    const request=fetchMock.mock.calls.find(([path,options])=>path==='/api/tasks'&&options.method==='POST')!;
    expect(request[1].headers['Idempotency-Key']).toBe(key);
    expect(JSON.parse(request[1].body)).toMatchObject({title:'Unconfirmed task',priority:'medium',dependsOn:null});
  });
});

describe('desktop drawer and navigation shortcuts', () => {
  it('remembers the collapsed drawer without discarding a draft or changing the current view', async () => {
    signedIn(); wrapper=mount(ClerkGate); await flushPromises();
    await wrapper.get('[aria-label="New task title"]').setValue('Keep this draft');
    await wrapper.get('[aria-label="Close sidebar"]').trigger('click');
    expect(wrapper.get('[aria-label="Open sidebar"]').attributes('aria-expanded')).toBe('false');
    expect(localStorage.getItem('planwatch:sidebar-collapsed')).toBe('true');
    expect(wrapper.get<HTMLInputElement>('[aria-label="New task title"]').element.value).toBe('Keep this draft');
    wrapper.unmount(); wrapper=mount(ClerkGate); await flushPromises();
    expect(wrapper.get('[aria-label="Open sidebar"]').attributes('aria-expanded')).toBe('false');
    await wrapper.get('[aria-label="Open sidebar"]').trigger('click');
    expect(wrapper.get('[aria-label="Close sidebar"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get<HTMLInputElement>('[aria-label="New task title"]').element.value).toBe('Keep this draft');
  });
  it('moves between search and capture with keyboard focus while preserving task drafts', async () => {
    signedIn(); wrapper=mount(ClerkGate,{attachTo:document.body}); await flushPromises();
    await wrapper.get('[aria-label="New task title"]').setValue('A task to keep');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('.search-control input').element);
    expect(wrapper.get('.workspace-nav button[aria-current="page"]').text()).toBe('Tasks');
    await button('New task').trigger('click'); await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[aria-label="New task title"]').element);
    expect(wrapper.get<HTMLInputElement>('[aria-label="New task title"]').element.value).toBe('A task to keep');
  });
});
