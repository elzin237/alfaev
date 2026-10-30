import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider,type UseQueryOptions} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn(),enabled:true}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>mocks.enabled}));
vi.mock("../services/inventoryHeldRowsService",()=>({getInventoryHeldRows:mocks.read}));
import {useInventoryHeldAccounting} from "./useInventoryHeldAccounting";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
const ids=INVENTORY_WAREHOUSES.map(w=>w.id),raw=ids[0]!,fg=ids[1]!;
const auth={session:{user:{id:"actor"},access_token:"token"},profile:{id:"profile",authUserId:"actor",isActive:true},isActive:true,isLoading:false,error:null};
const value={items:[{productId:"product",warehouseWorkOrderHeld:"0",netAvailableAfterAllCommitments:"-9"}],observations:["2026-10-30T10:00:00Z"]};
function context(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return{client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
beforeEach(()=>{vi.resetAllMocks();mocks.enabled=true;mocks.auth.mockReturnValue(auth);mocks.read.mockResolvedValue({ok:true,value});});afterEach(cleanup);
it.each(["gate","warehouse","raw-without-customs","inactive","identity","not-requested"])("fails closed even on forced refetch: %s",async kind=>{
  if(kind==="gate")mocks.enabled=false;
  if(kind==="inactive")mocks.auth.mockReturnValue({...auth,isActive:false});
  if(kind==="identity")mocks.auth.mockReturnValue({...auth,profile:{...auth.profile,authUserId:"other"}});
  const r=renderHook(()=>useInventoryHeldAccounting(raw,"",kind==="warehouse"?[]:kind==="raw-without-customs"?[raw]:ids,kind!=="not-requested"),context());
  await act(async()=>{await r.result.current.query.refetch();});expect(mocks.read).not.toHaveBeenCalled();expect(r.result.current.rows).toBeUndefined();
});
it("preserves zero held, negative net, scoped keys and focus/reconnect without polling",async()=>{
  const ctx=context(),r=renderHook(()=>useInventoryHeldAccounting(fg,"part",ids),ctx);
  await waitFor(()=>expect(r.result.current.rows?.get("product")).toEqual(value.items[0]));
  const q=ctx.client.getQueryCache().getAll()[0]!;expect(q.queryKey).toEqual(["inventory-reservation-accounting",expect.stringMatching(/^https?:/),"actor","profile","table",fg,"part",[...ids].sort(),true]);
  const opts=q.options as UseQueryOptions;expect(opts.refetchOnWindowFocus).toBe("always");expect(opts.refetchOnReconnect).toBe("always");expect(opts.refetchInterval).toBeUndefined();
});
it.each(["work-orders","projects","inventory","permission"])("refreshes after same-scope %s changes, not another profile",async kind=>{
  const ctx=context(),r=renderHook(()=>useInventoryHeldAccounting(fg,"",ids),ctx);await waitFor(()=>expect(r.result.current.rows).toBeDefined());
  const key=(profile:string)=>kind==="permission"?[kind,"actor",profile,"work_orders.view"]:kind==="inventory"?[kind,"products",profile]:[kind,"detail",profile,"source"];
  ctx.client.setQueryData(key("other"),{});await act(async()=>{await ctx.client.invalidateQueries({queryKey:key("other")});});expect(mocks.read).toHaveBeenCalledTimes(1);
  ctx.client.setQueryData(key("profile"),{});await act(async()=>{await ctx.client.invalidateQueries({queryKey:key("profile")});});await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
});
it("hides cached values after profile/warehouse permission changes and failed reads",async()=>{
  const r=renderHook(({allowed})=>useInventoryHeldAccounting(fg,"",allowed?ids:[]),{...context(),initialProps:{allowed:true}});await waitFor(()=>expect(r.result.current.rows).toBeDefined());
  r.rerender({allowed:false});expect(r.result.current.rows).toBeUndefined();
  mocks.auth.mockReturnValue({...auth,profile:{...auth.profile,id:"new-profile"}});mocks.read.mockResolvedValue({ok:false,error:{code:"access_denied",message:"Unavailable"}});
  r.rerender({allowed:true});expect(r.result.current.rows).toBeUndefined();await waitFor(()=>expect(r.result.current.query.data?.ok).toBe(false));expect(r.result.current.rows).toBeUndefined();
});
