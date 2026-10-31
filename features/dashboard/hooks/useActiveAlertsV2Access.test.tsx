import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { act,cleanup,renderHook,waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),permission:vi.fn(),counts:vi.fn(),enabled:true}));
vi.mock('../../../app/auth/AuthProvider',()=>({useAuth:mocks.auth}));
vi.mock('../../../app/auth/permissionService',()=>({hasPermission:mocks.permission}));
vi.mock('../../../app/config/activeAlertsV2Activation',()=>({isActiveAlertsV2Enabled:()=>mocks.enabled}));
vi.mock('../../../app/config/workOrderNotificationsActivation',()=>({isWorkOrderNotificationsEnabled:()=>false}));
vi.mock('../services/activeAlertsV2Service',async original=>({...await original<typeof import('../services/activeAlertsV2Service')>(),getActiveProblemCountsV2:mocks.counts}));
import { useActiveProblemsCountV2 } from './useActiveAlertsV2';
const actor='00000000-0000-4000-8000-000000000001',profile='00000000-0000-4000-8000-000000000002';
const identity={session:{user:{id:actor},access_token:'captured'},profile:{id:profile,authUserId:actor,isActive:true},isActive:true,isAdmin:false,isLoading:false,error:null};
let allowed=new Set<string>();
function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return{client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
beforeEach(()=>{vi.clearAllMocks();mocks.enabled=true;mocks.auth.mockReturnValue(identity);allowed=new Set(['dashboard.view','work_orders.view']);mocks.permission.mockImplementation(async(key:string)=>({ok:true,value:allowed.has(key)}));mocks.counts.mockResolvedValue({ok:true,value:{activeProblems:'1',workOrderShortages:'1',projectShortages:'0',projectIssues:'0',unreadUpdates:'0',asOf:'2026-10-31T10:00:00Z'}});});
afterEach(cleanup);
it('supports WO-only permissions independently of the old release gate',async()=>{
  const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(r.result.current.value?.activeProblems).toBe('1'));
  expect(r.result.current.scope?.permissions).toBe('w');expect(r.result.current.access.canReadProjects).toBe(false);expect(mocks.permission).toHaveBeenCalledWith('work_orders.view');ctx.client.clear();
});
it('clears visibility and caches after current module permissions are revoked',async()=>{
  const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);await waitFor(()=>expect(r.result.current.value).toBeTruthy());const prefix=r.result.current.scope!;
  allowed.clear();await act(async()=>{await ctx.client.invalidateQueries({queryKey:['permission',actor,profile]});});await waitFor(()=>expect(r.result.current.allowed).toBe(false));expect(r.result.current.value).toBeUndefined();
  expect(ctx.client.getQueryCache().findAll({queryKey:['dashboard','active-alerts-v2',prefix.backendOrigin,actor,profile]})).toHaveLength(0);ctx.client.clear();
});
it('does not run permission or v2 reads for mismatched Auth/profile identities',async()=>{
  mocks.auth.mockReturnValue({...identity,profile:{...identity.profile,authUserId:'other'}});const ctx=setup(),r=renderHook(()=>useActiveProblemsCountV2(),ctx);
  await act(async()=>{await r.result.current.query.refetch();});expect(mocks.permission).not.toHaveBeenCalled();expect(mocks.counts).not.toHaveBeenCalled();ctx.client.clear();
});
