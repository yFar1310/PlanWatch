import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils';
import AdminPanel from '../AdminPanel.vue';
import {setAuthTokenProvider} from '../api';
const fetchMock=vi.fn();let wrapper:VueWrapper|undefined;
const invitation={id:'invite-id',label:'Alex',status:'active',createdAt:1,expiresAt:Date.now()+86400000};
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
beforeEach(()=>{setAuthTokenProvider(null);vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();});
afterEach(()=>{wrapper?.unmount();vi.unstubAllGlobals();});
describe('administrator invitation management',()=>{
  it('confirms deletion, removes the invitation and clears the newly generated link',async()=>{
    let present=true;
    fetchMock.mockImplementation(async(path:string,options:RequestInit)=>{
      if(path==='/api/admin/invitations')return json({link:'https://example.test/#invite=example',invitation});
      if(path.endsWith('/delete')){expect(JSON.parse(options.body as string)).toEqual({confirmed:true});present=false;return json({deleted:true});}
      return json({totals:{members:1,banned:0,recentlySeen:0,activeMs:0,tasks:0},members:[],nextCursor:null,invitations:present?[invitation]:[]});
    });
    wrapper=mount(AdminPanel);await flushPromises();await wrapper.get('.invite-form input').setValue('Alex');await wrapper.get('.invite-form').trigger('submit');await flushPromises();expect(wrapper.find('.invite-result').exists()).toBe(true);
    await wrapper.get('[aria-label="Delete invitation Alex"]').trigger('click');expect(fetchMock.mock.calls.some(([path])=>path.endsWith('/delete'))).toBe(false);
    await wrapper.findAll('dialog button').find(button=>button.text()==='Cancel')!.trigger('click');expect(wrapper.find('dialog').exists()).toBe(false);
    await wrapper.get('[aria-label="Delete invitation Alex"]').trigger('click');await wrapper.findAll('dialog button').find(button=>button.text()==='Delete invitation')!.trigger('click');await flushPromises();
    expect(wrapper.find('.admin-invites').exists()).toBe(false);expect(wrapper.find('.invite-result').exists()).toBe(false);expect(wrapper.text()).toContain('Invitation deleted');
  });
  it('keeps the invitation and the confirmation visible when deletion fails',async()=>{
    fetchMock.mockImplementation(async(path:string)=>path.endsWith('/delete')?json({message:'Temporarily unavailable'},503):json({totals:{members:1,banned:0,recentlySeen:0,activeMs:0,tasks:0},members:[],nextCursor:null,invitations:[{...invitation,status:'used'}]}));
    wrapper=mount(AdminPanel);await flushPromises();await wrapper.get('[aria-label="Delete invitation Alex"]').trigger('click');expect(wrapper.get('dialog').text()).toContain('account and tasks will be kept');
    await wrapper.findAll('dialog button').find(button=>button.text()==='Delete invitation')!.trigger('click');await flushPromises();expect(wrapper.find('dialog').exists()).toBe(true);expect(wrapper.find('.admin-invites').exists()).toBe(true);expect(wrapper.emitted('failure')).toHaveLength(1);
  });
});
