import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),read:vi.fn(),save:vi.fn(),permission:vi.fn(),gate:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../../../app/auth/permissionService",()=>({hasPermission:mocks.permission}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:mocks.gate}));
vi.mock("../services/inventoryStockHealthService",async original=>({...await original<typeof import("../services/inventoryStockHealthService")>(),getInventoryStockHealth:mocks.read,setInventoryStockMinimum:mocks.save}));
import { useInventoryStockHealth } from "./useInventoryStockHealth";
import { dashboardStockHealthPrefix, invalidatePhysicalStockHealth, stockHealthPrefix } from "../stockHealthQueryKeys";
const raw="10000000-0000-4000-8000-000000000001";
const auth={session:{user:{id:"actor-1"},access_token:"token"},profile:{id:"profile-1",authUserId:"actor-1",isActive:true},isActive:true,isAdmin:true,isLoading:false,error:null};
const row={productId:"product-1",warehouseId:raw,productName:"Product",isActive:true,physicalQuantity:"10",minimumQuantity:"5",version:"1",status:"HEALTHY"};
function context(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return {client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockReturnValue(auth);mocks.gate.mockReturnValue(true);mocks.read.mockResolvedValue({ok:true,value:[row]});mocks.permission.mockResolvedValue({ok:true,value:true});mocks.save.mockResolvedValue({ok:true,value:{}});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("gate OFF prevents read, permission RPC and save even through forced refetch",async()=>{
  mocks.gate.mockReturnValue(false);const r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),context());
  await act(async()=>{await r.result.current.query.refetch();await r.result.current.save("product","5",null);});
  expect(mocks.read).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.permission).not.toHaveBeenCalled();
});
it.each([{isActive:false},{isLoading:true},{profile:null},{session:null},{error:{message:"failed"}},{profile:{...auth.profile,authUserId:"other"}}])("fails closed for invalid identity %j",async patch=>{
  mocks.auth.mockReturnValue({...auth,...patch});const r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),context());await act(async()=>{await r.result.current.query.refetch();});expect(mocks.read).not.toHaveBeenCalled();expect(r.result.current.canEdit).toBe(false);
});
it("requires warehouse view plus edit for a non-Admin; viewing alone still works",async()=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:false});mocks.permission.mockResolvedValue({ok:true,value:false});const r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),context());
  await waitFor(()=>expect(r.result.current.rows).toEqual([row]));expect(r.result.current.canEdit).toBe(false);
  await act(async()=>{await r.result.current.save("product","5",null);});expect(mocks.save).not.toHaveBeenCalled();
});
it("allows a non-Admin editor only after the edit permission is verified",async()=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:false});const r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),context());
  await waitFor(()=>expect(r.result.current.canEdit).toBe(true));expect(mocks.permission).toHaveBeenCalledWith("inventory.products.edit");
  await act(async()=>{await r.result.current.save("product","5",null);});expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("denied warehouse prevents all reads even for an Admin",async()=>{
  const r=renderHook(()=>useInventoryStockHealth(raw,"",null,false),context());await act(async()=>{await r.result.current.query.refetch();});expect(mocks.read).not.toHaveBeenCalled();
});
it("scopes queries by backend/actor/profile/warehouse/search/filter and ignores late previous searches",async()=>{
  let finish!:(v:unknown)=>void;mocks.read.mockImplementation((_w,search)=>search==="old"?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,value:[row]}));
  const ctx=context(),r=renderHook(({search})=>useInventoryStockHealth(raw,search,null,true),{...ctx,initialProps:{search:"old"}});
  r.rerender({search:"new"});await waitFor(()=>expect(r.result.current.rows).toEqual([row]));
  await act(async()=>{finish({ok:true,value:[{...row,minimumQuantity:"99"}]});});expect(r.result.current.rows).toEqual([row]);
  expect(ctx.client.getQueryCache().find({queryKey:[...stockHealthPrefix("actor-1","profile-1"),raw,"new",null]})?.state.data).toMatchObject({ok:true});
});
it("invalidates only initiating Inventory/Dashboard identity after a confirmed save",async()=>{
  const ctx=context(),r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),ctx);await waitFor(()=>expect(r.result.current.rows).toBeDefined());
  const invalidate=vi.spyOn(ctx.client,"invalidateQueries");await act(async()=>{await r.result.current.save("product","9007199254740993","1");});
  expect(mocks.save).toHaveBeenCalledWith("product",raw,"9007199254740993","1","token");
  expect(invalidate).toHaveBeenCalledWith({queryKey:stockHealthPrefix("actor-1","profile-1")});expect(invalidate).toHaveBeenCalledWith({queryKey:dashboardStockHealthPrefix("actor-1","profile-1")});
});
it("retains conflict feedback without automatic retry or refreshing away the edit",async()=>{
  mocks.save.mockResolvedValue({ok:false,error:{code:"conflict",message:"Refresh first"}});const ctx=context(),r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),ctx);
  await waitFor(()=>expect(r.result.current.rows).toBeDefined());const invalidate=vi.spyOn(ctx.client,"invalidateQueries");let result:unknown;
  await act(async()=>{result=await r.result.current.save("product","5","1");});expect(result).toMatchObject({ok:false,error:{code:"conflict"}});expect(invalidate).not.toHaveBeenCalled();expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("hides old values during retry/error and account changes",async()=>{
  const r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),context());await waitFor(()=>expect(r.result.current.rows).toBeDefined());
  mocks.read.mockResolvedValue({ok:false,error:{code:"access_denied",message:"Denied"}});await act(async()=>{await r.result.current.query.refetch();});await waitFor(()=>expect(r.result.current.rows).toBeUndefined());
  mocks.auth.mockReturnValue({...auth,profile:{...auth.profile,id:"profile-2"}});r.rerender();expect(r.result.current.rows).toBeUndefined();
});
it("suppresses hidden-view values and refreshes when the view becomes visible",async()=>{
  let hidden=false;vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);
  const r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),context());await waitFor(()=>expect(r.result.current.rows).toBeDefined());
  act(()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});expect(r.result.current.rows).toBeUndefined();
  await act(async()=>{await r.result.current.query.refetch();});expect(mocks.read).toHaveBeenCalledTimes(1);
  act(()=>{hidden=false;document.dispatchEvent(new Event("visibilitychange"));});await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(r.result.current.rows).toEqual([row]));
});
it("refreshes health on existing Product invalidation without cross-profile invalidation",async()=>{
  const ctx=context();
  const r=renderHook(()=>useInventoryStockHealth(raw,"",null,true),ctx);await waitFor(()=>expect(r.result.current.rows).toBeDefined());
  ctx.client.setQueryData(["inventory","products","profile-1",raw,""],[]);
  const invalidate=vi.spyOn(ctx.client,"invalidateQueries");await act(async()=>{await ctx.client.invalidateQueries({queryKey:["inventory","products","profile-1"]});});
  expect(invalidate).toHaveBeenCalledWith({queryKey:stockHealthPrefix("actor-1","profile-1")});expect(invalidate).toHaveBeenCalledWith({queryKey:dashboardStockHealthPrefix("actor-1","profile-1")});
});
it("physical stock invalidation covers only this profile's Inventory and Dashboard caches",async()=>{
  const {client}=context();for(const [actor,profile] of [["actor-1","profile-1"],["actor-2","profile-2"]]){
    client.setQueryData(stockHealthPrefix(actor,profile),[]);client.setQueryData(dashboardStockHealthPrefix(actor,profile),{});
  }
  await invalidatePhysicalStockHealth(client,"profile-1");
  expect(client.getQueryState(stockHealthPrefix("actor-1","profile-1"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(dashboardStockHealthPrefix("actor-1","profile-1"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(stockHealthPrefix("actor-2","profile-2"))?.isInvalidated).toBe(false);client.clear();
});
