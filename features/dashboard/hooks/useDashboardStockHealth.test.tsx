import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn(),permission:vi.fn(),gate:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../../../app/auth/permissionService",()=>({hasPermission:mocks.permission}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:mocks.gate}));
vi.mock("../services/dashboardStockHealthService",async original=>({...await original<typeof import("../services/dashboardStockHealthService")>(),getDashboardStockHealth:mocks.read}));
import { useDashboardStockHealth } from "./useDashboardStockHealth";
import { dashboardStockHealthPrefix } from "../../inventory/stockHealthQueryKeys";
const raw="10000000-0000-4000-8000-000000000001",fg="10000000-0000-4000-8000-000000000002";
const auth={session:{user:{id:"actor-1"},access_token:"memory-token"},profile:{id:"profile-1",authUserId:"actor-1",isActive:true},isActive:true,isAdmin:true,isLoading:false,error:null};
const warehouse={warehouseId:raw,warehouseCode:"raw_materials",warehouseName:"Raw Materials",productCount:"0",healthyCount:"0",lowStockCount:"0",outOfStockCount:"0",notConfiguredCount:"0"};
const model={asOf:"2026-10-28T10:00:00Z",warehouses:[warehouse],criticalItems:[]};
function context(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return {client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockReturnValue(auth);mocks.gate.mockReturnValue(true);mocks.permission.mockResolvedValue({ok:true,value:true});mocks.read.mockResolvedValue({ok:true,value:model});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("OFF prevents reads and permission checks even on forced refetch",async()=>{
  mocks.gate.mockReturnValue(false);const r=renderHook(()=>useDashboardStockHealth(),context());await act(async()=>{await r.result.current.query.refetch();});expect(mocks.read).not.toHaveBeenCalled();expect(mocks.permission).not.toHaveBeenCalled();expect(r.result.current.data).toBeUndefined();
});
it("Admin uses one snapshot request with identity-scoped cache and no permission N+1",async()=>{
  const ctx=context(),r=renderHook(()=>useDashboardStockHealth(),ctx);await waitFor(()=>expect(r.result.current.data).toEqual(model));
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith("memory-token",expect.any(AbortSignal));expect(mocks.permission).not.toHaveBeenCalled();
  expect(r.result.current.query.isSuccess).toBe(true);expect(ctx.client.getQueryCache().findAll({queryKey:dashboardStockHealthPrefix("actor-1","profile-1")})).toHaveLength(1);
});
it.each([{isActive:false},{profile:null},{session:null},{error:{message:"failed"}},{profile:{...auth.profile,authUserId:"other"}},{profile:{...auth.profile,isActive:false}}])("denies invalid/inactive identity %j",async patch=>{
  mocks.auth.mockReturnValue({...auth,...patch});const r=renderHook(()=>useDashboardStockHealth(),context());await act(async()=>{await r.result.current.query.refetch();});expect(mocks.read).not.toHaveBeenCalled();expect(r.result.current.status).toBe("denied");
});
it("waits for permission verification and allows FG-only Dashboard viewers",async()=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:false});mocks.permission.mockImplementation(async key=>({ok:true,value:["dashboard.view","inventory.finished_goods.view"].includes(key)}));
  const output={...warehouse,warehouseId:fg,warehouseCode:"finished_goods",warehouseName:"Finished Goods"};mocks.read.mockResolvedValue({ok:true,value:{...model,warehouses:[output]}});
  const r=renderHook(()=>useDashboardStockHealth(),context());await waitFor(()=>expect(r.result.current.status).toBe("ready"));expect(r.result.current.data?.warehouses).toEqual([output]);
  expect(mocks.permission).toHaveBeenCalledTimes(4);expect(mocks.read).toHaveBeenCalledTimes(1);
});
it.each(["dashboard","warehouses"])("denies missing %s permissions without RPC",async kind=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:false});mocks.permission.mockImplementation(async key=>({ok:true,value:kind==="dashboard"?key!=="dashboard.view":key==="dashboard.view"}));
  const r=renderHook(()=>useDashboardStockHealth(),context());await waitFor(()=>expect(r.result.current.status).toBe("denied"));expect(mocks.read).not.toHaveBeenCalled();
});
it("fails closed when backend warehouses exceed verified permissions",async()=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:false});mocks.permission.mockImplementation(async key=>({ok:true,value:["dashboard.view","inventory.finished_goods.view"].includes(key)}));
  const r=renderHook(()=>useDashboardStockHealth(),context());await waitFor(()=>expect(r.result.current.status).toBe("error"));expect(r.result.current.data).toBeUndefined();
});
it("shows a permission-check error without requesting or displaying stock health",async()=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:false});mocks.permission.mockResolvedValue({ok:false,error:{message:"Failed"}});
  const r=renderHook(()=>useDashboardStockHealth(),context());await waitFor(()=>expect(r.result.current.status).toBe("error"));expect(mocks.read).not.toHaveBeenCalled();expect(r.result.current.data).toBeUndefined();
});
it("hides sections on backend denial or no authorized warehouses, not zero placeholders",async()=>{
  mocks.read.mockResolvedValue({ok:false,error:{code:"access_denied",message:"denied"}});const r=renderHook(()=>useDashboardStockHealth(),context());await waitFor(()=>expect(r.result.current.status).toBe("denied"));
  mocks.read.mockResolvedValue({ok:true,value:{...model,warehouses:[]}});await act(async()=>{await r.result.current.query.refetch();});await waitFor(()=>expect(r.result.current.status).toBe("denied"));
});
it("refreshes through LS-03 invalidation, discards stale values and shows errors without old counts",async()=>{
  const ctx=context(),r=renderHook(()=>useDashboardStockHealth(),ctx);await waitFor(()=>expect(r.result.current.data).toEqual(model));
  mocks.read.mockResolvedValue({ok:false,error:{code:"unavailable",message:"failed"}});await act(async()=>{await ctx.client.invalidateQueries({queryKey:dashboardStockHealthPrefix("actor-1","profile-1")});});
  await waitFor(()=>expect(r.result.current.status).toBe("error"));expect(r.result.current.data).toBeUndefined();expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("old identity responses cannot populate the new profile",async()=>{
  let finish!:(v:unknown)=>void;mocks.read.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({ok:true,value:{...model,warehouses:[]}});
  const r=renderHook(()=>useDashboardStockHealth(),context());mocks.auth.mockReturnValue({...auth,session:{...auth.session,user:{id:"actor-2"}},profile:{...auth.profile,id:"profile-2",authUserId:"actor-2"}});r.rerender();
  await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));await act(async()=>{finish({ok:true,value:model});});expect(r.result.current.data?.warehouses).not.toEqual(model.warehouses);
});
it("coalesces existing Product invalidations into a scoped Dashboard refresh",async()=>{
  const ctx=context(),r=renderHook(()=>useDashboardStockHealth(),ctx);await waitFor(()=>expect(r.result.current.data).toEqual(model));
  ctx.client.setQueryData(["inventory","products","profile-1",raw],[]);const invalidation=vi.spyOn(ctx.client,"invalidateQueries");
  await act(async()=>{await ctx.client.invalidateQueries({queryKey:["inventory","products","profile-1"]});});expect(invalidation).toHaveBeenCalledWith({queryKey:dashboardStockHealthPrefix("actor-1","profile-1")});
});
it("hidden views do not show stale data and refetch on visibility return without polling",async()=>{
  let hidden=false;vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);const r=renderHook(()=>useDashboardStockHealth(),context());await waitFor(()=>expect(r.result.current.data).toBeDefined());
  act(()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});expect(r.result.current.data).toBeUndefined();await act(async()=>{await r.result.current.query.refetch();});expect(mocks.read).toHaveBeenCalledTimes(1);
  act(()=>{hidden=false;document.dispatchEvent(new Event("visibilitychange"));});await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
});
