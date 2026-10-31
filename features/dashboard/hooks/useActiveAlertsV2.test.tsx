import { QueryClient,QueryClientProvider,focusManager,onlineManager } from '@tanstack/react-query';
import { act,cleanup,fireEvent,render,renderHook,screen,waitFor } from '@testing-library/react';
import { Link,MemoryRouter,Route,Routes,useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({enabled:true,auth:vi.fn(),access:vi.fn(),counts:vi.fn(),list:vi.fn(),ack:vi.fn(),receipt:vi.fn()}));
vi.mock('../../../app/config/activeAlertsV2Activation',()=>({isActiveAlertsV2Enabled:()=>mocks.enabled}));
vi.mock('../../../app/auth/AuthProvider',()=>({useAuth:mocks.auth}));
vi.mock('./useProjectAlerts',()=>({useProjectAlertAccess:mocks.access}));
vi.mock('../services/activeAlertsV2Service',async original=>({...await original<typeof import('../services/activeAlertsV2Service')>(),getActiveProblemCountsV2:mocks.counts,listActiveAlertPageV2:mocks.list,acknowledgeProblemV2:mocks.ack,updateAlertReceiptV2:mocks.receipt}));
import { useActiveProblemsCountV2,useActiveConditionInboxV2,useAlertsHistoryV2,useUnreadUpdatesV2,useAcknowledgeProblemV2,useAlertReceiptV2 } from './useActiveAlertsV2';
import type { AlertCondition } from '../services/activeAlertsV2Service';
import { activeAlertBackend,activeAlertV2Prefix,invalidateActiveAlertV2Queries,type ActiveAlertScope } from '../activeAlertsV2QueryKeys';
import { frontendEnv } from '../../../lib/config/env';
import DashboardSidebarAlertBadge from '../components/DashboardSidebarAlertBadge';
const actor='00000000-0000-4000-8000-000000000001',profile='00000000-0000-4000-8000-000000000002',condition='00000000-0000-4000-8000-000000000003';
const auth=()=>({session:{user:{id:actor},access_token:'captured-token'},profile:{id:profile,authUserId:actor,isActive:true},isActive:true,isAdmin:true,isLoading:false,error:null});
const access=()=>({profileId:profile,canRead:true,canReadProjects:true,canReadWorkOrders:true,permissionsPending:false,scope:'pw'});
const counts={activeProblems:'3',workOrderShortages:'1',projectShortages:'1',projectIssues:'1',unreadUpdates:'2',asOf:'2026-10-31T12:00:00Z'};
const page={items:[],hasMore:false,nextCursor:null,asOf:counts.asOf};
const scope=():ActiveAlertScope=>({backendOrigin:activeAlertBackend(),authUserId:actor,profileId:profile,permissions:'pw'});
function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return{client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
const originalBackend=frontendEnv.supabaseUrl;
beforeEach(()=>{vi.clearAllMocks();mocks.enabled=true;mocks.auth.mockReturnValue(auth());mocks.access.mockReturnValue(access());mocks.counts.mockResolvedValue({ok:true,value:counts});mocks.list.mockResolvedValue({ok:true,value:page});mocks.ack.mockResolvedValue({ok:true,value:{kind:'project_issue',id:condition,acknowledgedAt:counts.asOf}});});
afterEach(()=>{cleanup();(frontendEnv as {supabaseUrl:string}).supabaseUrl=originalBackend;focusManager.setFocused(undefined);onlineManager.setOnline(true);});
it('keeps all v2 reads and explicit refetch/acknowledgment blocked when OFF',async()=>{
  mocks.enabled=false;const ctx=setup(),r=renderHook(()=>({c:useActiveProblemsCountV2(),i:useActiveConditionInboxV2(true),h:useAlertsHistoryV2(true),u:useUnreadUpdatesV2(true),a:useAcknowledgeProblemV2()}),ctx);
  await act(async()=>{await r.result.current.c.query.refetch();await r.result.current.i.query.refetch();await r.result.current.h.query.refetch();await r.result.current.u.query.refetch();await r.result.current.a.acknowledge('project_issue',condition);});
  expect(mocks.counts).not.toHaveBeenCalled();expect(mocks.list).not.toHaveBeenCalled();expect(mocks.ack).not.toHaveBeenCalled();expect(r.result.current.c.value).toBeUndefined();ctx.client.clear();
});
it('uses one backend/Auth/profile/permission-scoped authoritative count for separate metrics',async()=>{
  const ctx=setup(),r=renderHook(()=>({c:useActiveProblemsCountV2(),u:useUnreadUpdatesV2()}),ctx);
  await waitFor(()=>expect(r.result.current.c.value?.activeProblems).toBe('3'));expect(r.result.current.u.unreadCount).toBe('2');
  expect(ctx.client.getQueryData([...activeAlertV2Prefix(scope()),'counts'])).toEqual(counts);
  expect(mocks.counts).toHaveBeenCalledWith({accessToken:'captured-token',backendOrigin:activeAlertBackend()},expect.any(AbortSignal));ctx.client.clear();
});
it.each([{isActive:false},{isLoading:true},{error:{code:'denied'}},{session:null},{profile:{...auth().profile,authUserId:'different'}}])('fails closed on invalid identity %j',async patch=>{
  mocks.auth.mockReturnValue({...auth(),...patch});const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);
  await act(async()=>{await r.result.current.query.refetch();});expect(mocks.counts).not.toHaveBeenCalled();expect(r.result.current.value).toBeUndefined();ctx.client.clear();
});
it('does not dispatch while permissions are pending or unavailable',async()=>{
  mocks.access.mockReturnValue({...access(),canRead:false,permissionsPending:true});const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);
  await act(async()=>{await r.result.current.query.refetch();});expect(mocks.counts).not.toHaveBeenCalled();ctx.client.clear();
});
it('paginates from authoritative cursors, never from unread state or display quantities',async()=>{
  const cursor={beforeAt:counts.asOf,beforeKind:'project_issue' as const,beforeId:condition};mocks.list.mockResolvedValueOnce({ok:true,value:{...page,hasMore:true,nextCursor:cursor}}).mockResolvedValue({ok:true,value:page});
  const ctx=setup(),r=renderHook(()=>useActiveConditionInboxV2(true),ctx);await waitFor(()=>expect(r.result.current.query.hasNextPage).toBe(true));
  await act(async()=>{await r.result.current.query.fetchNextPage();});expect(mocks.list).toHaveBeenLastCalledWith({feed:'conditions',status:'active',cursor},expect.any(Object),expect.any(AbortSignal));ctx.client.clear();
});
it('invalidates all four new query families only for the exact current scope',async()=>{
  const ctx=setup(),s=scope(),other={...s,authUserId:'other',profileId:'other-profile'};
  for(const family of ['counts','conditions','history','updates']){ctx.client.setQueryData([...activeAlertV2Prefix(s),family],page);ctx.client.setQueryData([...activeAlertV2Prefix(other),family],page);}
  await invalidateActiveAlertV2Queries(ctx.client,s);
  for(const family of ['counts','conditions','history','updates']){expect(ctx.client.getQueryState([...activeAlertV2Prefix(s),family])?.isInvalidated).toBe(true);expect(ctx.client.getQueryState([...activeAlertV2Prefix(other),family])?.isInvalidated).toBe(false);}ctx.client.clear();
});
it('does not optimistically decrement count when a read feed refreshes',async()=>{
  const ctx=setup(),r=renderHook(()=>({c:useActiveProblemsCountV2(),i:useActiveConditionInboxV2(true)}),ctx);
  await waitFor(()=>expect(r.result.current.c.value?.activeProblems).toBe('3'));await act(async()=>{await r.result.current.i.query.refetch();});
  expect(r.result.current.c.value?.activeProblems).toBe('3');ctx.client.clear();
});
it('invalidates after verified acknowledgment and prevents concurrent duplicate dispatch',async()=>{
  let finish!:(v:any)=>void;mocks.ack.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const ctx=setup(),spy=vi.spyOn(ctx.client,'invalidateQueries'),r=renderHook(()=>useAcknowledgeProblemV2(),ctx);let first!:Promise<any>;
  await act(async()=>{first=r.result.current.acknowledge('project_issue',condition);});await act(async()=>{expect((await r.result.current.acknowledge('project_issue',condition)).ok).toBe(false);});expect(mocks.ack).toHaveBeenCalledTimes(1);
  await act(async()=>{finish({ok:true,value:{kind:'project_issue',id:condition,acknowledgedAt:counts.asOf}});await first;});expect(spy).toHaveBeenCalledWith({queryKey:activeAlertV2Prefix(scope())});ctx.client.clear();
});
it('isolates profile, backend and permission changes and rejects late old-identity responses',async()=>{
  let finish!:(v:any)=>void;mocks.counts.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(mocks.counts).toHaveBeenCalled());const old=scope();
  mocks.auth.mockReturnValue({...auth(),session:{...auth().session,user:{id:'actor-two'}},profile:{...auth().profile,id:'profile-two',authUserId:'actor-two'}});mocks.access.mockReturnValue({...access(),profileId:'profile-two',scope:'p',canReadWorkOrders:false});r.rerender();
  await act(async()=>{finish({ok:true,value:{...counts,activeProblems:'99'}});});await waitFor(()=>expect(r.result.current.value?.activeProblems).toBe('3'));expect(ctx.client.getQueryData([...activeAlertV2Prefix(old),'counts'])).toBeUndefined();
  (frontendEnv as {supabaseUrl:string}).supabaseUrl='https://new-backend.invalid';r.rerender();await waitFor(()=>expect(r.result.current.scope?.backendOrigin).toBe('https://new-backend.invalid'));expect(r.result.current.value?.activeProblems).not.toBe('99');ctx.client.clear();
});
it('retains no authoritative value on backend denial or error',async()=>{
  mocks.counts.mockResolvedValue({ok:false,error:{code:'access_denied',message:'Denied'}});const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(mocks.counts).toHaveBeenCalled());expect(r.result.current.value).toBeUndefined();ctx.client.clear();
});
it('refreshes on focus and reconnect without polling',async()=>{
  const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(r.result.current.value).toBeTruthy());const before=mocks.counts.mock.calls.length;
  await act(async()=>{focusManager.setFocused(false);focusManager.setFocused(true);});await waitFor(()=>expect(mocks.counts.mock.calls.length).toBeGreaterThan(before));const middle=mocks.counts.mock.calls.length;
  await act(async()=>{onlineManager.setOnline(false);onlineManager.setOnline(true);});await waitFor(()=>expect(mocks.counts.mock.calls.length).toBeGreaterThan(middle));ctx.client.clear();
});
it('does not invalidate another identity after a late acknowledgment receipt',async()=>{
  let finish!:(v:any)=>void;mocks.ack.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const ctx=setup(),spy=vi.spyOn(ctx.client,'invalidateQueries'),r=renderHook(()=>useAcknowledgeProblemV2(),ctx);let pending!:Promise<any>;
  await act(async()=>{pending=r.result.current.acknowledge('project_issue',condition);});
  mocks.auth.mockReturnValue({...auth(),session:{...auth().session,user:{id:'new-actor'}},profile:{...auth().profile,id:'new-profile',authUserId:'new-actor'}});mocks.access.mockReturnValue({...access(),profileId:'new-profile'});r.rerender();
  await act(async()=>{finish({ok:true,value:{kind:'project_issue',id:condition,acknowledgedAt:counts.asOf}});expect((await pending).ok).toBe(false);});expect(spy).not.toHaveBeenCalled();ctx.client.clear();
});
it('keeps authoritative counts unchanged on active-condition or uncertain acknowledgment rejection',async()=>{
  for(const code of ['active_condition','unavailable']){
    mocks.ack.mockResolvedValue({ok:false,error:{code,message:'Unavailable'}});const ctx=setup(),spy=vi.spyOn(ctx.client,'invalidateQueries'),r=renderHook(()=>useAcknowledgeProblemV2(),ctx);
    ctx.client.setQueryData([...activeAlertV2Prefix(scope()),'counts'],counts);await act(async()=>{expect((await r.result.current.acknowledge('project_issue',condition)).ok).toBe(false);});
    expect(ctx.client.getQueryData([...activeAlertV2Prefix(scope()),'counts'])).toEqual(counts);expect(spy).not.toHaveBeenCalled();r.unmount();ctx.client.clear();
  }
});
it('scopes receipt invalidation, retains count until server confirmation and rejects a late profile receipt',async()=>{
  const item={kind:'project_shortage',id:condition,notificationId:condition} as AlertCondition;
  let finish!:(v:any)=>void;mocks.receipt.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const ctx=setup(),spy=vi.spyOn(ctx.client,'invalidateQueries'),r=renderHook(()=>useAlertReceiptV2(),ctx);let pending!:Promise<any>;
  ctx.client.setQueryData([...activeAlertV2Prefix(scope()),'counts'],counts);
  await act(async()=>{pending=r.result.current.update('read',item);});
  expect(ctx.client.getQueryData([...activeAlertV2Prefix(scope()),'counts'])).toEqual(counts);
  expect(mocks.receipt).toHaveBeenCalledWith('read',item,{accessToken:'captured-token',backendOrigin:activeAlertBackend()});
  await act(async()=>{finish({ok:true,value:{notificationId:condition,at:counts.asOf}});await pending;});expect(spy).toHaveBeenCalledWith({queryKey:activeAlertV2Prefix(scope())});
  spy.mockClear();mocks.receipt.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await act(async()=>{pending=r.result.current.update('read',item);});
  mocks.auth.mockReturnValue({...auth(),profile:{...auth().profile,id:'next-profile'}});mocks.access.mockReturnValue({...access(),profileId:'next-profile'});r.rerender();
  await act(async()=>{finish({ok:true,value:{notificationId:condition,at:counts.asOf}});expect((await pending).ok).toBe(false);});expect(spy).not.toHaveBeenCalled();ctx.client.clear();
});
it('never dispatches a read/dismiss receipt when OFF',async()=>{
  mocks.enabled=false;const ctx=setup(),r=renderHook(()=>useAlertReceiptV2(),ctx);
  await act(async()=>{await r.result.current.update('read',{} as AlertCondition);await r.result.current.update('dismiss_update',{} as AlertCondition);});expect(mocks.receipt).not.toHaveBeenCalled();ctx.client.clear();
});

function NavigationCountFixture() {
  const location=useLocation();
  return <><nav><Link to="/">Dashboard</Link><Link to="/projects">Projects</Link><Link to="/inventory">Inventory</Link></nav>
    <aside aria-label="Sidebar count"><DashboardSidebarAlertBadge key={location.pathname}/></aside>
    <Routes><Route path="/" element={<DashboardCountFixture/>}/><Route path="/projects" element={<p>Projects page</p>}/><Route path="/inventory" element={<p>Inventory page</p>}/></Routes></>;
}
function DashboardCountFixture(){const count=useActiveProblemsCountV2();return <output aria-label="Dashboard count">{count.value?.activeProblems??'Unavailable'}</output>;}
it('preserves the shared count through route navigation, sidebar remount and a pending refresh',async()=>{
  const ctx=setup();render(<MemoryRouter><NavigationCountFixture/></MemoryRouter>,ctx);
  await screen.findByLabelText('3 active problems');expect(screen.getByLabelText('Dashboard count')).toHaveTextContent('3');
  let finish!:(v:any)=>void;mocks.counts.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.click(screen.getByRole('link',{name:'Projects'}));await screen.findByText('Projects page');
  expect(screen.getByLabelText('3 active problems')).toBeInTheDocument();
  await act(async()=>{finish({ok:true,value:counts});});
  fireEvent.click(screen.getByRole('link',{name:'Inventory'}));await screen.findByText('Inventory page');
  expect(screen.getByLabelText('3 active problems')).toBeInTheDocument();
  await act(async()=>{finish({ok:true,value:counts});});
  fireEvent.click(screen.getByRole('link',{name:'Dashboard'}));
  expect(screen.getByLabelText('3 active problems')).toBeInTheDocument();expect(screen.getByLabelText('Dashboard count')).toHaveTextContent('3');
  await act(async()=>{finish({ok:true,value:{...counts,activeProblems:'4'}});});
  await waitFor(()=>expect(screen.getByLabelText('Dashboard count')).toHaveTextContent('4'));expect(screen.getByLabelText('4 active problems')).toBeInTheDocument();
});
it('retains a known same-scope count during refetch and transport error, but clears it on denial',async()=>{
  const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(r.result.current.value?.activeProblems).toBe('3'));
  let finish!:(v:any)=>void;mocks.counts.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));let pending!:Promise<any>;
  await act(async()=>{pending=r.result.current.query.refetch();});expect(r.result.current.value?.activeProblems).toBe('3');
  await act(async()=>{finish({ok:false,error:{code:'unavailable',message:'Network unavailable'}});await pending;});
  await waitFor(()=>expect(r.result.current.query.isError).toBe(true));expect(r.result.current.value?.activeProblems).toBe('3');
  mocks.counts.mockResolvedValue({ok:false,error:{code:'access_denied',message:'Denied'}});
  await act(async()=>{await r.result.current.query.refetch();});await waitFor(()=>expect(r.result.current.value).toBeUndefined());expect(ctx.client.getQueryData([...activeAlertV2Prefix(scope()),'counts'])).toBeUndefined();
});
it('keeps the remaining count observer live when a Dashboard observer unmounts',async()=>{
  const ctx=setup(),sidebar=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(sidebar.result.current.value?.activeProblems).toBe('3'));
  const dashboard=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(dashboard.result.current.value?.activeProblems).toBe('3'));
  dashboard.unmount();mocks.counts.mockResolvedValue({ok:true,value:{...counts,activeProblems:'4'}});
  await act(async()=>{await ctx.client.invalidateQueries({queryKey:activeAlertV2Prefix(scope())});});
  await waitFor(()=>expect(sidebar.result.current.value?.activeProblems).toBe('4'));expect(sidebar.result.current.query.isError).toBe(false);
});
it.each(['logout','profile','permissions','backend','gate'] as const)('never retains a known count after %s changes',async change=>{
  const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx),oldScope=scope();await waitFor(()=>expect(r.result.current.value?.activeProblems).toBe('3'));
  mocks.counts.mockReturnValue(new Promise(()=>{}));
  if(change==='logout')mocks.auth.mockReturnValue({...auth(),session:null,profile:null,isActive:false});
  if(change==='profile'){mocks.auth.mockReturnValue({...auth(),profile:{...auth().profile,id:'other-profile'}});mocks.access.mockReturnValue({...access(),profileId:'other-profile'});}
  if(change==='permissions')mocks.access.mockReturnValue({...access(),canRead:false,scope:'none'});
  if(change==='backend')(frontendEnv as {supabaseUrl:string}).supabaseUrl='https://other-backend.invalid';
  if(change==='gate')mocks.enabled=false;
  r.rerender();expect(r.result.current.value).toBeUndefined();expect(ctx.client.getQueryData([...activeAlertV2Prefix(oldScope),'counts'])).toBeUndefined();
});
