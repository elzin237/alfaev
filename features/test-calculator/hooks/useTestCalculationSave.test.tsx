import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),save:vi.fn(),reconcile:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../services/testCalculationSaveService",async original=>({...await original<typeof import("../services/testCalculationSaveService")>(),saveTestCalculation:mocks.save,reconcileTestCalculation:mocks.reconcile}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{}}));
import {useTestCalculationSave} from "./useTestCalculationSave";
import {testRecoveryKey,readTestRecovery,testCalculationHistoryPrefix,inventoryTestCommitmentsPrefix} from "../services/testCalculationRecoveryStore";
import {installRecoveryBrowser} from "../../../test/finishedGoodsRecoveryBrowser";
import type {TestCalculationDraft} from "../testCalculationDraft";
import type {TestCalculationPreview} from "../services/testCalculationPreviewService";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const identity={authUserId:id(1),profileId:id(2)};
const auth={session:{user:{id:id(1)},access_token:"memory-token"},profile:{id:id(2),authUserId:id(1),isActive:true},isActive:true,isLoading:false,error:null};
const draft:TestCalculationDraft={name:"Test",deadlineDate:"2090-01-01",items:[{product:{productId:id(4),name:"Component",serialNumber:"0000123",productKind:"component",sourcePolicy:"raw_customs_fg"},quantity:"9007199254740993"}]};
const preview:TestCalculationPreview={rows:[{productId:id(4),name:"Component",serialNumber:"0000123",productKind:"component",required:"9007199254740993",eligibleFree:"3",projectPriority:"0",available:"3",reservable:"3",missing:"9007199254740990",warehouses:[]}],asOf:"2026-10-27T11:00:00Z",saveWillRecalculate:true};
const receipt={calculationId:id(5),requestId:id(6),name:"Test",deadlineDate:draft.deadlineDate,expiresAt:"2090-01-01T23:00:00Z",createdAt:"2026-10-27T11:00:00Z",items:[]};
function setup(enabled=true){const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 return{client,...renderHook(({current,fingerprint})=>useTestCalculationSave(current,preview,fingerprint,enabled),{wrapper,initialProps:{current:draft,fingerprint:JSON.stringify(draft)}})};}
beforeEach(()=>{vi.resetAllMocks();installRecoveryBrowser();mocks.auth.mockReturnValue(auth);mocks.save.mockImplementation(async request=>({ok:true,value:{...receipt,requestId:request.requestId}}));mocks.reconcile.mockResolvedValue(true);});
afterEach(cleanup);
describe("Test Save durable controller (mock transport)",()=>{
 it("persists before dispatch, reconciles, refreshes scoped reads and clears exactly its journal",async()=>{
  const r=setup(),invalidate=vi.spyOn(r.client,"invalidateQueries");await waitFor(()=>expect(r.result.current.canSave).toBe(true));
  mocks.save.mockImplementationOnce(async request=>{expect(readTestRecovery(identity)?.request).toEqual(request);expect(localStorage.getItem(testRecoveryKey(identity))).not.toContain("memory-token");return{ok:true,value:{...receipt,requestId:request.requestId}};});
  await act(async()=>{await r.result.current.submit();});expect(r.result.current.saved).not.toBeNull();expect(readTestRecovery(identity)).toBeNull();
  expect(invalidate).toHaveBeenCalledWith({queryKey:testCalculationHistoryPrefix(identity)},{throwOnError:true});
  expect(invalidate).toHaveBeenCalledWith({queryKey:inventoryTestCommitmentsPrefix(identity)},{throwOnError:true});
  expect(mocks.save.mock.calls[0]![0].items[0].quantity).toBe("9007199254740993");
 });
 it("blocks duplicate clicks and recovers the exact UUID after complete client restart",async()=>{
  mocks.save.mockResolvedValue({ok:false,error:{code:"outcome_uncertain",uncertain:true,message:"Uncertain"}});
  const r=setup();await waitFor(()=>expect(r.result.current.canSave).toBe(true));
  await act(async()=>{await Promise.all([r.result.current.submit(),r.result.current.submit()]);});expect(mocks.save).toHaveBeenCalledTimes(1);
  const original=mocks.save.mock.calls[0]![0];r.unmount();const restarted=setup();await waitFor(()=>expect(restarted.result.current.pending).not.toBeNull());
  expect(mocks.save).toHaveBeenCalledTimes(1);expect(restarted.result.current.canSave).toBe(false);
  mocks.save.mockResolvedValue({ok:true,value:{...receipt,requestId:original.requestId}});
  await act(async()=>{await restarted.result.current.recover();});expect(mocks.save.mock.calls[1]![0]).toEqual(original);expect(readTestRecovery(identity)).toBeNull();
 });
 it("keeps known success until reconciliation and refresh finish, then retries only the read",async()=>{
  mocks.reconcile.mockResolvedValueOnce(false);const r=setup();await waitFor(()=>expect(r.result.current.canSave).toBe(true));
  await act(async()=>{await r.result.current.submit();});expect(r.result.current.saved).toBeNull();expect(readTestRecovery(identity)?.state).toBe("confirmed_success");
  await act(async()=>{await r.result.current.recover();});expect(mocks.save).toHaveBeenCalledTimes(1);expect(mocks.reconcile).toHaveBeenCalledTimes(2);expect(readTestRecovery(identity)).toBeNull();
 });
 it("retains permission failures and isolates a different identity without leaking saved data",async()=>{
  mocks.save.mockResolvedValue({ok:false,error:{code:"42501",uncertain:false,message:"Denied"}});const r=setup();await waitFor(()=>expect(r.result.current.canSave).toBe(true));
  await act(async()=>{await r.result.current.submit();});expect(readTestRecovery(identity)).not.toBeNull();
  mocks.auth.mockReturnValue({...auth,session:{user:{id:id(8)},access_token:"other"},profile:{...auth.profile,id:id(9),authUserId:id(8)}});r.rerender({current:draft,fingerprint:JSON.stringify(draft)});
  expect(r.result.current.pending).toBeNull();expect(r.result.current.saved).toBeNull();await act(async()=>{await r.result.current.recover();});expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(testRecoveryKey(identity))).not.toBeNull();
 });
 it("blocks corrupted/unavailable persistence and stale proof without dispatch",async()=>{
  localStorage.setItem(testRecoveryKey(identity),"corrupt");const r=setup();await waitFor(()=>expect(r.result.current.error).toMatch(/storage/));
  await act(async()=>{await r.result.current.submit();});expect(mocks.save).not.toHaveBeenCalled();expect(localStorage.getItem(testRecoveryKey(identity))).toBe("corrupt");
  r.unmount();localStorage.clear();const clean=setup();await waitFor(()=>expect(clean.result.current.canSave).toBe(true));
  clean.rerender({current:{...draft,name:"Edited"},fingerprint:JSON.stringify(draft)});expect(clean.result.current.canSave).toBe(false);
 });
 it("never dispatches without activation or overwrites a changed original journal",async()=>{
  const off=setup(false);await act(async()=>{await off.result.current.submit();});expect(mocks.save).not.toHaveBeenCalled();off.unmount();
  mocks.save.mockResolvedValue({ok:false,error:{code:"outcome_uncertain",uncertain:true,message:"Uncertain"}});const r=setup();await waitFor(()=>expect(r.result.current.canSave).toBe(true));
  await act(async()=>{await r.result.current.submit();});const record=readTestRecovery(identity)!;localStorage.setItem(testRecoveryKey(identity),JSON.stringify({...record,request:{...record.request,name:"Changed"}}));
  await act(async()=>{await r.result.current.recover();});expect(mocks.save).toHaveBeenCalledTimes(1);expect(r.result.current.error).toMatch(/storage/);
 });
 it("treats a lost post-commit response as unresolved and exact replay has one simulated backend effect",async()=>{
  let effects=0;const committed=new Map<string,typeof receipt>();
  mocks.save.mockImplementation(async request=>{if(!committed.has(request.requestId)){effects++;committed.set(request.requestId,{...receipt,requestId:request.requestId});return{ok:false,error:{code:"outcome_uncertain",uncertain:true,message:"Lost response"}};}return{ok:true,value:committed.get(request.requestId)};});
  const first=setup();await waitFor(()=>expect(first.result.current.canSave).toBe(true));await act(async()=>{await first.result.current.submit();});
  first.unmount();const restart=setup();await waitFor(()=>expect(restart.result.current.pending).not.toBeNull());
  await act(async()=>{await restart.result.current.recover();});expect(effects).toBe(1);expect(restart.result.current.saved).not.toBeNull();
 });
 it("retains the matching journal if cache refresh fails and prevents another Save after completion",async()=>{
  const r=setup();await waitFor(()=>expect(r.result.current.canSave).toBe(true));
  const invalidate=vi.spyOn(r.client,"invalidateQueries").mockRejectedValueOnce(new Error("refresh unavailable"));
  await act(async()=>{await r.result.current.submit();});expect(readTestRecovery(identity)).not.toBeNull();expect(r.result.current.saved).toBeNull();
  invalidate.mockRestore();await act(async()=>{await r.result.current.recover();});
  await act(async()=>{await r.result.current.submit();});expect(mocks.save).toHaveBeenCalledTimes(1);expect(r.result.current.saved).not.toBeNull();
 });
 it("does not regenerate an original UUID when recovery storage disappears",async()=>{
  mocks.save.mockResolvedValue({ok:false,error:{code:"outcome_uncertain",uncertain:true,message:"Lost"}});
  const r=setup();await waitFor(()=>expect(r.result.current.canSave).toBe(true));await act(async()=>{await r.result.current.submit();});
  localStorage.removeItem(testRecoveryKey(identity));const uuid=vi.spyOn(crypto,"randomUUID");
  await act(async()=>{await r.result.current.recover();});expect(uuid).not.toHaveBeenCalled();expect(mocks.save).toHaveBeenCalledTimes(1);expect(r.result.current.blocked).toBe(true);uuid.mockRestore();
 });
 it("retains an old actor's late response without poisoning the new actor's pending request",async()=>{
  let finish!: (value:unknown)=>void;
  mocks.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({ok:false,error:{code:"outcome_uncertain",uncertain:true,message:"Lost B"}});
  const r=setup();await waitFor(()=>expect(r.result.current.canSave).toBe(true));let old!:Promise<void>;
  act(()=>{old=r.result.current.submit();});await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));const first=mocks.save.mock.calls[0]![0];
  const other={authUserId:id(8),profileId:id(9)};
  mocks.auth.mockReturnValue({...auth,session:{user:{id:id(8)},access_token:"other"},profile:{...auth.profile,id:id(9),authUserId:id(8)}});
  r.rerender({current:draft,fingerprint:JSON.stringify(draft)});await waitFor(()=>expect(r.result.current.canSave).toBe(true));
  await act(async()=>{await r.result.current.submit();});const second=mocks.save.mock.calls[1]![0];
  await act(async()=>{finish({ok:true,value:{...receipt,requestId:first.requestId}});await old;});
  expect(r.result.current.pending?.request.requestId).toBe(second.requestId);expect(r.result.current.saved).toBeNull();
  await act(async()=>{await r.result.current.recover();});expect(mocks.save.mock.calls[2]![0]).toEqual(second);
  expect(readTestRecovery(other)).toBeNull();expect(readTestRecovery(identity)?.state).toBe("confirmed_success");
 });
});
