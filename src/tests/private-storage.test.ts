import { beforeEach, afterEach, describe, expect, it,vi } from 'vitest';
import { activateDrafts, deactivateDrafts, capture, drafts,ideaCapture } from '../drafts';
import { captureInvitation, clearInvitation, pendingInvitation, invitationCode } from '../invitations';
beforeEach(() => { deactivateDrafts(); localStorage.clear(); sessionStorage.clear(); history.replaceState(null,'','/'); });
afterEach(() => { deactivateDrafts(); clearInvitation(); });
describe('private drafts and invitation handoff', () => {
  it('keeps idea drafts separate from advanced capture and private across workspace changes',()=>{
    activateDrafts('alice');ideaCapture.value={title:'Call mum',key:'save-key',payload:'pending-payload'};capture.value.title='An advanced task';
    deactivateDrafts();expect(ideaCapture.value.title).toBe('');activateDrafts('bob');expect(ideaCapture.value.title).toBe('');ideaCapture.value.title='Bob’s idea';
    activateDrafts('alice');expect(ideaCapture.value).toEqual({title:'Call mum',key:'save-key',payload:'pending-payload'});expect(capture.value.title).toBe('An advanced task');
  });
  it('keeps each account’s drafts isolated through sign-out, account changes and reload', () => {
    activateDrafts('workspace-alice'); capture.value.title='Alice private draft';
    drafts.value['alice-task']={plannedEndDate:'',startTime:'',endTime:'',title:'Private edit',notes:'Secret',status:'todo',priority:'high',dependsOn:null,plannedDate:'',estimate:'',actual:'',version:1};
    deactivateDrafts(); expect(capture.value.title).toBe(''); expect(drafts.value).toEqual({});
    activateDrafts('workspace-bob'); expect(capture.value.title).toBe(''); expect(drafts.value).toEqual({});
    capture.value.title='Bob draft';
    activateDrafts('workspace-alice'); expect(capture.value.title).toBe('Alice private draft'); expect(drafts.value['alice-task']?.notes).toBe('Secret');
    deactivateDrafts(); activateDrafts('workspace-bob'); expect(capture.value.title).toBe('Bob draft'); expect(drafts.value).toEqual({});
  });
  it('migrates unscoped legacy drafts only for the verified administrator', () => {
    localStorage.setItem('planwatch:capture:v1',JSON.stringify({title:'Old owner draft',plannedDate:'',key:null,payload:null}));
    activateDrafts('workspace-friend'); expect(capture.value.title).toBe('');
    expect(localStorage.getItem('planwatch:capture:v1')).not.toBeNull();
    activateDrafts('personal',true); expect(capture.value.title).toBe('Old owner draft'); expect(capture.value.priority).toBe('medium');
    expect(localStorage.getItem('planwatch:capture:v1')).toBeNull();
    activateDrafts('workspace-friend'); expect(capture.value.title).toBe('');
  });
  it('holds the invitation through sign-in redirects and removes the code from the address', () => {
    const code='a'.repeat(43); history.replaceState(null,'','/#invite='+code);
    captureInvitation(); expect(pendingInvitation.value).toBe(code); expect(location.hash).toBe('');
    pendingInvitation.value=''; history.replaceState(null,'','/#/sso-callback');
    captureInvitation(); expect(pendingInvitation.value).toBe(code);
    expect(invitationCode('https://example.test/#invite='+code)).toBe(code);
    expect(invitationCode('not a link')).toBe('');
    clearInvitation(); captureInvitation(); expect(pendingInvitation.value).toBe('');
  });
  it('retains the invitation through same-page auth routing when browser storage is blocked',()=>{
    const storage=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Blocked');});
    const writer=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Blocked');});
    try{const code='b'.repeat(43);history.replaceState(null,'','/#invite='+code);captureInvitation();history.replaceState(null,'','/#/sign-in');captureInvitation();expect(pendingInvitation.value).toBe(code);}
    finally{storage.mockRestore();writer.mockRestore();}
  });
});
