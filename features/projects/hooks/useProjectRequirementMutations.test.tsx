import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),mutate:vi.fn(),planning:vi.fn(),fg:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../services/projectRequirementMutationService",async original=>({...await original<typeof import("../services/projectRequirementMutationService")>(),mutateProjectRequirement:mocks.mutate}));
vi.mock("../services/projectPlanningService",()=>({getProjectPlanning:mocks.planning}));
vi.mock("../services/projectFinishedGoodsService",()=>({getProjectFinishedGoods:mocks.fg}));
import { useProjectRequirementMutations } from "./useProjectRequirementMutations";
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { requirementRecoveryKey } from "../services/projectRequirementRecoveryStore";
import { projectFinishedGoodsQueryKeys } from "../projectFinishedGoodsQueryKeys";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const identity={authUserId:id(1),profileId:id(2),projectId:id(3)};
const input={operation:"create" as const,projectId:id(3),groupId:id(4),componentId:null,productId:id(5),quantity:"9007199254740993",expectedProductId:null,expectedQuantity:null};
function render(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return{...renderHook(()=>useProjectRequirementMutations(id(3)),{wrapper}),client};}
beforeEach(()=>{vi.resetAllMocks();installRecoveryBrowser();mocks.auth.mockReturnValue({session:{user:{id:id(1)},access_token:"memory-only"},profile:{id:id(2),isActive:true},isAdmin:true});
  mocks.planning.mockResolvedValue({ok:true,value:[]});mocks.fg.mockResolvedValue({ok:true,value:[]});
  mocks.mutate.mockImplementation(async request=>({ok:true,value:{request_id:request.requestId,component_id:id(6),operation:request.operation,affected_products:[]}}));});
afterEach(cleanup);
describe("atomic requirement recovery controller",()=>{
  it("persists before dispatch, reconciles and invalidates nested FG aggregates",async()=>{
    const r=render(),invalidate=vi.spyOn(r.client,"invalidateQueries");
    mocks.mutate.mockImplementationOnce(async request=>{expect(JSON.parse(localStorage.getItem(requirementRecoveryKey(identity))!).request).toEqual(request);return{ok:true,value:{component_id:id(6)}};});
    await act(async()=>{expect(await r.result.current.execute(input)).toEqual({ok:true,value:{id:id(6)}});});
    expect(localStorage.getItem(requirementRecoveryKey(identity))).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({queryKey:["inventory","commitments",id(2)]});expect(mocks.fg).toHaveBeenCalled();
  });
  it("five rapid clicks dispatch once, then reload recovery requires explicit exact replay",async()=>{
    mocks.mutate.mockResolvedValue({ok:false,error:{uncertain:true,code:"outcome_uncertain",message:"uncertain"}});
    const r=render();await act(async()=>{await Promise.all(Array.from({length:5},()=>r.result.current.execute(input)));});
    expect(mocks.mutate).toHaveBeenCalledTimes(1);const original=mocks.mutate.mock.calls[0]![0];r.unmount();
    const restarted=render();await waitFor(()=>expect(restarted.result.current.pending).not.toBeNull());expect(mocks.mutate).toHaveBeenCalledTimes(1);
    mocks.mutate.mockResolvedValue({ok:true,value:{component_id:id(6)}});
    await act(async()=>{await restarted.result.current.retry();});expect(mocks.mutate.mock.calls[1]![0]).toEqual(original);
    expect(localStorage.getItem(requirementRecoveryKey(identity))).toBeNull();
  });
  it("does not clear a confirmed receipt until authoritative refresh succeeds, or overwrite with historical stock",async()=>{
    const r=render();mocks.fg.mockResolvedValueOnce({ok:false,error:{code:"load_failed"}});
    await act(async()=>{expect((await r.result.current.execute(input)).ok).toBe(false);});expect(r.result.current.pending).not.toBeNull();
    mocks.fg.mockResolvedValueOnce({ok:true,value:[{physicalQuantity:7n}]});
    await act(async()=>{await r.result.current.retry();});
    expect(r.client.getQueryData(projectFinishedGoodsQueryKeys.context(id(2),id(3)))).toEqual({ok:true,value:[{physicalQuantity:7n}]});
  });
  it("retains permission-change uncertainty and isolates an account switch",async()=>{
    const r=render();mocks.mutate.mockResolvedValue({ok:false,error:{uncertain:true,code:"42501",message:"denied"}});
    await act(async()=>{await r.result.current.execute(input);});expect(r.result.current.pending).not.toBeNull();
    mocks.auth.mockReturnValue({session:{user:{id:id(8)},access_token:"other"},profile:{id:id(9),isActive:true},isAdmin:true});r.rerender();
    await waitFor(()=>expect(r.result.current.pending).toBeNull());await act(async()=>{await r.result.current.retry();});
    expect(mocks.mutate).toHaveBeenCalledTimes(1);expect(localStorage.getItem(requirementRecoveryKey(identity))).not.toBeNull();
  });
  it("does not replace a known pending UUID if its storage entry disappears",async()=>{
    const r=render();mocks.mutate.mockResolvedValue({ok:false,error:{uncertain:true,message:"uncertain",code:"outcome_uncertain"}});
    await act(async()=>{await r.result.current.execute(input);});localStorage.removeItem(requirementRecoveryKey(identity));
    await act(async()=>{expect((await r.result.current.execute(input)).ok).toBe(false);});expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(r.result.current.error).toMatch(/storage/i);
  });
  it("corrupted persistence blocks dispatch without deleting the evidence",async()=>{
    localStorage.setItem(requirementRecoveryKey(identity),"corrupt");const r=render();
    await act(async()=>{expect((await r.result.current.execute(input)).ok).toBe(false);});expect(mocks.mutate).not.toHaveBeenCalled();
    expect(localStorage.getItem(requirementRecoveryKey(identity))).toBe("corrupt");
  });
});
