import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),list:vi.fn(),detail:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../services/testCalculationHistoryService",async original=>({...await original<typeof import("../services/testCalculationHistoryService")>(),listTestCalculations:mocks.list,getTestCalculation:mocks.detail}));
import {useTestCalculationHistory,useTestCalculationDetail} from "./useTestCalculationHistory";
import {testCalculationHistoryPrefix} from "../services/testCalculationRecoveryStore";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const auth={session:{user:{id:id(1)},access_token:"memory-token"},profile:{id:id(2),authUserId:id(1),isActive:true},isActive:true,isLoading:false,error:null};
function context(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return{client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockReturnValue(auth);mocks.list.mockResolvedValue({ok:true,value:{rows:[],nextCursor:null}});mocks.detail.mockResolvedValue({ok:false,error:{code:"not_found",message:"Not found"}});});
afterEach(cleanup);
describe("identity scoped Test history hooks",()=>{
 it("default gates refuse even manual refetch",async()=>{
  const ctx=context(),r=renderHook(()=>({list:useTestCalculationHistory(),detail:useTestCalculationDetail(id(3))}),ctx);
  await act(async()=>{await r.result.current.list.query.refetch();await r.result.current.detail.query.refetch();});
  expect(mocks.list).not.toHaveBeenCalled();expect(mocks.detail).not.toHaveBeenCalled();expect(r.result.current.list.query.data).toBeUndefined();
 });
 it("uses exactly the Save invalidation prefix, and scopes data by backend, actor and profile",async()=>{
  const ctx=context(),r=renderHook(()=>useTestCalculationHistory(true),ctx);await waitFor(()=>expect(r.result.current.query.data).toBeDefined());
  expect(ctx.client.getQueryCache().getAll()[0]!.queryKey).toEqual([...testCalculationHistoryPrefix({authUserId:id(1),profileId:id(2)}),"list",20]);
  mocks.auth.mockReturnValue({...auth,profile:{...auth.profile,id:id(9)}});mocks.list.mockReturnValueOnce(new Promise(()=>{}));r.rerender();
  expect(r.result.current.query.data).toBeUndefined();expect(ctx.client.getQueryCache().getAll()).toHaveLength(2);
 });
 it.each([{session:null},{profile:null},{isActive:false},{profile:{...auth.profile,isActive:false}},{profile:{...auth.profile,authUserId:id(9)}},{error:{code:"failed"}}])("fails closed on invalid identity %j",async patch=>{
  mocks.auth.mockReturnValue({...auth,...patch});const r=renderHook(()=>useTestCalculationHistory(true),context());
  await act(async()=>{await r.result.current.query.refetch();});expect(mocks.list).not.toHaveBeenCalled();expect(r.result.current.query.data).toBeUndefined();
 });
 it("refreshes once at a server-provided expiry without deleting expired rows or using browser time for status",async()=>{
  const row={calculationId:id(3),name:"Near expiry",creatorFullName:"Creator",createdAt:"2019-01-01T00:00:00Z",deadlineDate:"2020-01-01",deadlineTimezone:"Europe/Sarajevo",expiresAt:"2020-01-01T23:00:00.040000Z",status:"active",asOf:"2020-01-01T23:00:00Z"};
  mocks.list.mockResolvedValueOnce({ok:true,value:{rows:[row],nextCursor:null}}).mockResolvedValue({ok:true,value:{rows:[{...row,status:"expired",asOf:row.expiresAt}],nextCursor:null}});
  const r=renderHook(()=>useTestCalculationHistory(true),context());
  await waitFor(()=>expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(r.result.current.query.data?.pages[0]).toMatchObject({ok:true,value:{rows:[{name:"Near expiry",status:"expired"}]}});
 });
});
