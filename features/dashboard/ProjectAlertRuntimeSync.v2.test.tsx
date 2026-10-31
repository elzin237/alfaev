import { act,cleanup,render,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({enabled:true,tracking:true,auth:vi.fn(),access:vi.fn(),oldInvalidate:vi.fn(),oldRemove:vi.fn(),subscribe:vi.fn(),subscriptions:[] as any[]}));
vi.mock('../../app/config/activeAlertsV2Activation',()=>({isActiveAlertsV2Enabled:()=>mocks.enabled}));
vi.mock('../../app/config/workOrderActiveShortagesActivation',()=>({isWorkOrderActiveShortagesEnabled:()=>mocks.tracking}));
vi.mock('../../app/auth/AuthProvider',()=>({useAuth:mocks.auth}));
vi.mock('./hooks/useProjectAlerts',()=>({useProjectAlertAccess:mocks.access,invalidateProjectAlertQueries:mocks.oldInvalidate,removeProjectAlertQueries:mocks.oldRemove}));
vi.mock('./services/projectAlertRealtimeService',()=>({subscribeToProjectAlertInvalidations:mocks.subscribe}));
import ProjectAlertRuntimeSync from './ProjectAlertRuntimeSync';
import { activeAlertBackend,activeAlertV2Prefix } from './activeAlertsV2QueryKeys';
const auth=()=>({session:{user:{id:'actor'},access_token:'captured-token'},profile:{id:'profile',authUserId:'actor',isActive:true},isActive:true,isLoading:false,error:null});
const access=()=>({profileId:'profile',canRead:true,canReadProjects:true,canReadWorkOrders:true,scope:'pw',permissionsPending:false});
const scope=()=>({backendOrigin:activeAlertBackend(),authUserId:'actor',profileId:'profile',permissions:'pw'});
const families=['counts','conditions','history','updates'];
beforeEach(()=>{vi.clearAllMocks();mocks.enabled=true;mocks.tracking=true;mocks.subscriptions=[];mocks.auth.mockReturnValue(auth());mocks.access.mockReturnValue(access());mocks.oldInvalidate.mockResolvedValue(undefined);mocks.subscribe.mockImplementation(options=>{const sub={options,unsubscribe:vi.fn()};mocks.subscriptions.push(sub);return sub;});});
afterEach(cleanup);
function setup(){const client=new QueryClient();const tree=<QueryClientProvider client={client}><ProjectAlertRuntimeSync/></QueryClientProvider>;return{client,tree};}
it('uses the existing two subscriptions to invalidate every new family, including WO signals',async()=>{
  const {client,tree}=setup(),prefix=activeAlertV2Prefix(scope()),other=activeAlertV2Prefix({...scope(),profileId:'other'});
  for(const f of families){client.setQueryData([...prefix,f],{});client.setQueryData([...other,f],{});}const r=render(tree);
  expect(mocks.subscribe).toHaveBeenCalledTimes(2);expect(mocks.subscriptions.map(s=>s.options.target)).toEqual([undefined,'work_order']);
  for(const subscription of mocks.subscriptions){
    for(const f of families)client.setQueryData([...prefix,f],{});
    await act(async()=>subscription.options.onInvalidate());
    await waitFor(()=>expect(client.getQueryState([...prefix,'counts'])?.isInvalidated).toBe(true));
    for(const f of families){expect(client.getQueryState([...prefix,f])?.isInvalidated).toBe(true);expect(client.getQueryState([...other,f])?.isInvalidated).toBe(false);}
  }
  r.unmount();client.clear();
});
it('refreshes v2 even if a legacy invalidation fails and ignores stale callbacks after cleanup',async()=>{
  mocks.oldInvalidate.mockRejectedValue(new Error('Legacy unavailable'));const {client,tree}=setup(),key=[...activeAlertV2Prefix(scope()),'counts'];client.setQueryData(key,{});const spy=vi.spyOn(client,'invalidateQueries'),r=render(tree),callback=mocks.subscriptions[0].options;
  await act(async()=>callback.onStatusChange('subscribed'));await waitFor(()=>expect(client.getQueryState(key)?.isInvalidated).toBe(true));
  r.unmount();const before=spy.mock.calls.length;await act(async()=>callback.onInvalidate());expect(spy).toHaveBeenCalledTimes(before);expect(mocks.subscriptions.every(s=>s.unsubscribe.mock.calls.length===1)).toBe(true);client.clear();
});
it('preserves legacy-only invalidation and subscription behavior when OFF',async()=>{
  mocks.enabled=false;const {client,tree}=setup(),spy=vi.spyOn(client,'invalidateQueries'),r=render(tree);
  expect(mocks.subscribe).toHaveBeenCalledTimes(2);await act(async()=>mocks.subscriptions[0].options.onInvalidate());
  await waitFor(()=>expect(mocks.oldInvalidate).toHaveBeenCalledWith(client,'profile'));expect(spy).not.toHaveBeenCalled();r.unmount();client.clear();
});
it('clears old permission scopes and replaces rather than duplicates subscriptions',async()=>{
  const {client,tree}=setup(),key=[...activeAlertV2Prefix(scope()),'counts'];client.setQueryData(key,{});const r=render(tree),old=[...mocks.subscriptions];
  mocks.access.mockReturnValue({...access(),scope:'p',canReadWorkOrders:false});r.rerender(<QueryClientProvider client={client}><ProjectAlertRuntimeSync/></QueryClientProvider>);
  await waitFor(()=>expect(client.getQueryData(key)).toBeUndefined());expect(old.every(s=>s.unsubscribe.mock.calls.length===1)).toBe(true);expect(mocks.subscribe).toHaveBeenCalledTimes(3);r.unmount();client.clear();
});
it('uses only the authorized WO channel for v2 WO-only access even with old tracking OFF',()=>{
  mocks.tracking=false;mocks.access.mockReturnValue({...access(),scope:'w',canReadProjects:false});const {client,tree}=setup(),r=render(tree);
  expect(mocks.subscribe).toHaveBeenCalledTimes(1);expect(mocks.subscriptions[0].options.target).toBe('work_order');r.unmount();client.clear();
});
