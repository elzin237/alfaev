import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),query:{setHeader:vi.fn(),abortSignal:vi.fn()}}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
import { mutateProjectRequirement,validRequirementRequest,type RequirementRequest } from "./projectRequirementMutationService";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const request:RequirementRequest={requestId:id(1),operation:"create",projectId:id(2),groupId:id(3),componentId:null,productId:id(4),quantity:"9007199254740993",expectedProductId:null,expectedQuantity:null};
const receipt={request_id:id(1),operation:"create",component_id:id(5),affected_products:[{product_id:id(4),reserved_quantity:"3",outstanding_demand:"9007199254740993",uncovered_demand:"9007199254740990"}]};
beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockReturnValue(mocks.query);mocks.query.setHeader.mockReturnValue(mocks.query);mocks.query.abortSignal.mockResolvedValue({data:receipt,error:null});});
describe("atomic requirement RPC",()=>{
  it("accepts an empty affected-FG list when the backend authoritatively classifies an ordinary Product",async()=>{
    mocks.query.abortSignal.mockResolvedValue({data:{...receipt,affected_products:[]},error:null});
    expect(await mutateProjectRequirement(request)).toMatchObject({ok:true,value:{affected_products:[]}});
  });
  it("passes exact decimal strings and original UUID to the single RPC",async()=>{
    expect(await mutateProjectRequirement(request)).toEqual({ok:true,value:receipt});
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("mutate_project_requirement",{p_request_id:id(1),p_operation:"create",p_project_id:id(2),p_project_product_id:id(3),p_component_id:null,p_product_id:id(4),p_required_quantity:"9007199254740993",p_expected_product_id:null,p_expected_quantity:null});
  });
  it.each([null,{}, {...receipt,request_id:id(9)}, {...receipt,affected_products:[{...receipt.affected_products[0],reserved_quantity:3}]},
    {...receipt,affected_products:[{...receipt.affected_products[0],uncovered_demand:"0"}]}, {...receipt,extra:"unexpected"}])("malformed success is uncertain, never a successful new allocation",async data=>{
    mocks.query.abortSignal.mockResolvedValue({data,error:null});expect(await mutateProjectRequirement(request)).toMatchObject({ok:false,error:{uncertain:true}});
  });
  it.each(["42501","FGR01","PGRST202","unknown"])("retains uncertainty for %s",async code=>{
    mocks.query.abortSignal.mockResolvedValue({data:null,error:{code}});expect(await mutateProjectRequirement(request)).toMatchObject({ok:false,error:{uncertain:true}});
  });
  it("recognizes a definite stale edit and a transport failure separately",async()=>{
    mocks.query.abortSignal.mockResolvedValueOnce({data:null,error:{code:"FGA02"}});expect(await mutateProjectRequirement(request)).toMatchObject({ok:false,error:{code:"FGA02",uncertain:false}});
    mocks.query.abortSignal.mockRejectedValueOnce(Error("timeout"));expect(await mutateProjectRequirement(request)).toMatchObject({ok:false,error:{uncertain:true}});
  });
  it.each(["0","1.5","01","9223372036854775808"])("rejects invalid SQL quantities %s without RPC",async quantity=>{
    expect(validRequirementRequest({...request,quantity})).toBe(false);await mutateProjectRequirement({...request,quantity});expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
