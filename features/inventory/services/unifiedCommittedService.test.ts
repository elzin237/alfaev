import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({enabled:false,rpc:vi.fn(),header:vi.fn(),abort:vi.fn()}));
vi.mock("../../../app/config/unifiedCommittedActivation",()=>({isUnifiedCommittedEnabled:()=>mocks.enabled}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
import {getUnifiedCommitted,parseUnifiedCommitted,setMaterialAttribution,unifiedCommittedPrefix,type AttributionRequest} from "./unifiedCommittedService";
const product="00000000-0000-4000-8000-000000000001",state="00000000-0000-4000-8000-000000000002",request="00000000-0000-4000-8000-000000000003",raw="10000000-0000-4000-8000-000000000001",customs="10000000-0000-4000-8000-000000000003";
const known={schema:2,metric_definition:"project_demand_plus_work_order_held",product_id:product,warehouse_id:raw,scope:"raw_customs",as_of:"2026-10-30T12:00:00Z",project_demand:"10",work_order_held:"10",committed_quantity:"20"};
const input:AttributionRequest={requestId:request,stateId:state,kind:"independent",materialVersion:"2",quantity:"10"};
beforeEach(()=>{vi.resetAllMocks();mocks.enabled=false;mocks.rpc.mockReturnValue({setHeader:mocks.header});mocks.header.mockReturnValue({abortSignal:mocks.abort});});
it("gate OFF prevents read and mutation RPCs",async()=>{await getUnifiedCommitted(product,raw,"token");await setMaterialAttribution(input,"token");expect(mocks.rpc).not.toHaveBeenCalled();});
it("parses exact additive reporting totals without precision loss",()=>{
  expect(parseUnifiedCommitted(known,product,raw).ok).toBe(true);
  expect(parseUnifiedCommitted({...known,project_demand:"23",work_order_held:"68",committed_quantity:"91"},product,raw).ok).toBe(true);
  expect(parseUnifiedCommitted({...known,project_demand:"9007199254740993",committed_quantity:"9007199254741003"},product,raw)).toMatchObject({ok:true,value:{committed_quantity:"9007199254741003"}});
});
it("rejects the old deduplicated/Unknown contract rather than mislabelling it as reporting",()=>{
  expect(parseUnifiedCommitted({...known,schema:1},product,raw).ok).toBe(false);
  expect(parseUnifiedCommitted({...known,proof_status:"unknown",committed_quantity:null},product,raw).ok).toBe(false);
  expect(parseUnifiedCommitted({...known,committed_quantity:"10"},product,raw).ok).toBe(false);
});
it.each([{work_order_held:10},{project_demand:"01"},{unknown_overlap:"1"},{verified_coverage:"11"},{coverage_adjustment:"1"},{independent_held:"11"},{committed_quantity:"19"},{as_of:"invalid"},{private_evidence:[]},{scope:"warehouse"}])("rejects unsafe/inconsistent authoritative response %j",patch=>{
  expect(parseUnifiedCommitted({...known,...patch},product,raw).ok).toBe(false);
});
it("preserves warehouse-only scope without inventing Project demand",()=>{expect(parseUnifiedCommitted({...known,warehouse_id:customs,scope:"warehouse",project_demand:"0",committed_quantity:"10"},product,customs).ok).toBe(true);});
it.each([["23","0","23"],["0","68","68"],["0","0","0"]])("reports %s + %s = %s",(project_demand,work_order_held,committed_quantity)=>{expect(parseUnifiedCommitted({...known,project_demand,work_order_held,committed_quantity},product,raw).ok).toBe(true);});
it("uses actor token and cancellation for authorized bounded reads",async()=>{mocks.enabled=true;mocks.abort.mockResolvedValue({data:known,error:null});expect((await getUnifiedCommitted(product,raw,"memory-token")).ok).toBe(true);expect(mocks.rpc).toHaveBeenCalledWith("get_inventory_unified_committed",{p_product_id:product,p_warehouse_id:raw});expect(mocks.header).toHaveBeenCalledWith("Authorization","Bearer memory-token");});
it("keeps an uncertain request identity unchanged for explicit retry",async()=>{
  mocks.enabled=true;mocks.abort.mockRejectedValueOnce(Error("transport"));expect(await setMaterialAttribution(input,"token")).toMatchObject({ok:false,error:{code:"uncertain"}});
  mocks.abort.mockResolvedValueOnce({data:{schema:1,request_id:request,kind:"independent",state_id:state},error:null});expect((await setMaterialAttribution(input,"token")).ok).toBe(true);
  expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);expect(mocks.rpc.mock.calls[1]![1].p_request_id).toBe(request);
});
it("separates terminal rejection from malformed/uncertain success",async()=>{
  mocks.enabled=true;mocks.abort.mockResolvedValueOnce({data:null,error:{code:"WRC11"}});expect(await setMaterialAttribution(input,"token")).toMatchObject({ok:false,error:{code:"rejected"}});
  mocks.abort.mockResolvedValueOnce({data:{schema:1,request_id:request},error:null});expect(await setMaterialAttribution(input,"token")).toMatchObject({ok:false,error:{code:"uncertain"}});
});
it.each(["-1","01","1.5","9223372036854775808"])("rejects invalid exact quantity %s without dispatch",async quantity=>{mocks.enabled=true;expect((await setMaterialAttribution({...input,quantity},"token")).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
it("scopes cache keys to backend, actor and profile",()=>{expect(unifiedCommittedPrefix("a","p")).not.toEqual(unifiedCommittedPrefix("b","p"));expect(unifiedCommittedPrefix("a","p")).not.toEqual(unifiedCommittedPrefix("a","q"));expect(unifiedCommittedPrefix("a","p")[1]).toMatch(/^https?:\/\//);});
