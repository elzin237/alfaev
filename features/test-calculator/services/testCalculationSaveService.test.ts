import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),header:vi.fn(),abort:vi.fn()}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
import {saveTestCalculation,reconcileTestCalculation,parseTestSaveReceipt,type TestSaveRequest} from "./testCalculationSaveService";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const request:TestSaveRequest={requestId:id(1),name:"Saved Test",deadlineDate:"2090-01-01",items:[{product_id:id(2),quantity:"5"}]};
const raw="10000000-0000-4000-8000-000000000001",customs="10000000-0000-4000-8000-000000000003",fg="10000000-0000-4000-8000-000000000002";
const receipt=(held="3",required="5")=>({calculation_id:id(3),request_id:id(1),name:"Saved Test",deadline_date:"2090-01-01",deadline_timezone:"Europe/Sarajevo",expires_at:"2090-01-01T23:00:00Z",created_at:"2026-10-27T11:00:00Z",items:[{
 product_id:id(2),name:"Component",serial_number:"0000123",product_kind:"component",required_quantity:required,held_quantity:held,uncovered_quantity:(BigInt(required)-BigInt(held)).toString(),warehouses:[{warehouse_id:raw,quantity:held},{warehouse_id:customs,quantity:"0"},{warehouse_id:fg,quantity:"0"}]}]});
beforeEach(()=>{vi.resetAllMocks();const chain={setHeader:mocks.header,abortSignal:mocks.abort};mocks.rpc.mockReturnValue(chain);mocks.header.mockReturnValue(chain);});
describe("Test Calculation atomic Save and reconciliation",()=>{
 it.each(["0","3","5"])("parses authoritative full/partial/zero held %s and pins actor token",async held=>{
  mocks.abort.mockResolvedValue({data:receipt(held),error:null});const result=await saveTestCalculation(request,"memory-token");
  expect(result).toMatchObject({ok:true,value:{items:[{required:"5",held,missing:(5n-BigInt(held)).toString()}]}});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_test_calculation",{p_request_id:id(1),p_name:"Saved Test",p_items:request.items,p_deadline_date:"2090-01-01"});
  expect(mocks.header).toHaveBeenCalledWith("Authorization","Bearer memory-token");
 });
 it("keeps maximum bigint and exact request replay after expiry",async()=>{
  const quantity="9223372036854775807",old={...request,deadlineDate:"2020-01-01",items:[{product_id:id(2),quantity}]};
  mocks.abort.mockResolvedValue({data:{...receipt(quantity,quantity),deadline_date:old.deadlineDate,expires_at:"2020-01-01T23:00:00Z",created_at:"2019-01-01T00:00:00Z"},error:null});
  expect(await saveTestCalculation(old,"token")).toMatchObject({ok:true,value:{items:[{held:quantity}]}});
  expect(mocks.rpc.mock.calls[0]![1].p_items[0].quantity).toBe(quantity);
 });
 it("treats malformed or lost success as uncertain and sanitizes denial",async()=>{
  for(const data of [{}, {...receipt(),request_id:id(9)}, {...receipt(),items:[{...receipt().items[0],held_quantity:3}]}]){
   mocks.abort.mockResolvedValueOnce({data,error:null});expect(await saveTestCalculation(request,"token")).toMatchObject({ok:false,error:{uncertain:true}});
  }
  mocks.abort.mockRejectedValueOnce(new Error("secret connection"));expect(JSON.stringify(await saveTestCalculation(request,"token"))).not.toContain("secret connection");
  mocks.abort.mockResolvedValueOnce({data:receipt(),error:{code:"42501",message:"private receipt"}});
  expect(await saveTestCalculation(request,"token")).toMatchObject({ok:false,error:{code:"42501"}});
 });
 it("verifies saved snapshot and positive holds using a fresh authorized detail read",async()=>{
  const saved=parseTestSaveReceipt(receipt(),request)!;
  const detail={calculation_id:saved.calculationId,name:saved.name,creator_full_name:"Creator",created_at:saved.createdAt,deadline_date:saved.deadlineDate,deadline_timezone:"Europe/Sarajevo",expires_at:saved.expiresAt,status:"active",as_of:"2026-10-27T12:00:00Z",items:[{
   item_id:id(4),product_id:id(2),product_name_snapshot:"Component",serial_number_snapshot:"0000123",product_kind_snapshot:"component",required_quantity:"5",held_quantity:"3",missing_quantity:"2",holds:[{warehouse_id:raw,warehouse_code:"raw_materials",quantity:"3"}]}]};
  mocks.abort.mockResolvedValueOnce({data:detail,error:null});expect(await reconcileTestCalculation(saved,"token")).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("get_test_calculation",{p_calculation_id:id(3)});
  mocks.abort.mockResolvedValueOnce({data:{...detail,items:[]},error:null});expect(await reconcileTestCalculation(saved,"token")).toBe(false);
  mocks.abort.mockResolvedValueOnce({data:detail,error:{code:"42501"}});expect(await reconcileTestCalculation(saved,"token")).toBe(false);
 });
});
