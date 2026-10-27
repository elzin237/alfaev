import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),header:vi.fn(),abort:vi.fn()}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
import {listTestCalculations,getTestCalculation,historyTimestampMicros} from "./testCalculationHistoryService";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const row={calculation_id:id(2),name:"Test",creator_full_name:"Other Creator",created_at:"2026-10-27T11:00:00.123456+00:00",deadline_date:"2090-01-01",deadline_timezone:"Europe/Sarajevo",expires_at:"2090-01-01T23:00:00Z",status:"active",as_of:"2026-10-27T12:00:00.000001Z"};
const raw="10000000-0000-4000-8000-000000000001";
const detail={...row,items:[{item_id:id(3),product_id:id(4),product_name_snapshot:"Saved archived name",serial_number_snapshot:"007",product_kind_snapshot:"pcb_finished_good",required_quantity:"9223372036854775807",held_quantity:"9007199254740993",missing_quantity:"9214364837600034814",holds:[{warehouse_id:raw,warehouse_code:"raw_materials",quantity:"9007199254740993"}]}]};
beforeEach(()=>{vi.resetAllMocks();const chain={setHeader:mocks.header,abortSignal:mocks.abort};mocks.rpc.mockReturnValue(chain);mocks.header.mockReturnValue(chain);});
describe("trusted saved Test history reads",()=>{
 it("sends complete keyset arguments, pins authorization and preserves raw microsecond cursor",async()=>{
  mocks.abort.mockResolvedValueOnce({data:[row],error:null});const result=await listTestCalculations(1,null,"memory-token");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_test_calculations",{p_limit:1,p_before_created_at:null,p_before_id:null});
  expect(mocks.header).toHaveBeenCalledWith("Authorization","Bearer memory-token");
  expect(result).toMatchObject({ok:true,value:{rows:[{creatorFullName:"Other Creator",status:"active"}],nextCursor:{createdAt:row.created_at,id:id(2)}}});
  if(!result.ok)throw Error();mocks.abort.mockResolvedValueOnce({data:[{...row,calculation_id:id(1),created_at:"2026-10-27T11:00:00.123455+00:00"}],error:null});
  expect((await listTestCalculations(1,result.value.nextCursor,"memory-token")).ok).toBe(true);
  expect(mocks.rpc.mock.calls[1]![1].p_before_created_at).toBe(row.created_at);
 });
 it("retains expired history and uses precise server expiry, never a browser clock estimate",async()=>{
  const expires="2026-10-27T12:00:00.000002Z";
  mocks.abort.mockResolvedValueOnce({data:[{...row,expires_at:expires,deadline_date:"2026-10-27"}],error:null});
  expect((await listTestCalculations(20,null,"token")).ok).toBe(true);
  mocks.abort.mockResolvedValueOnce({data:[{...row,expires_at:expires,status:"expired",as_of:expires,deadline_date:"2026-10-27"}],error:null});
  expect(await listTestCalculations(20,null,"token")).toMatchObject({ok:true,value:{rows:[{status:"expired"}],nextCursor:null}});
  expect(historyTimestampMicros("2026-10-27T12:00:00.000002Z")!-historyTimestampMicros("2026-10-27T12:00:00.000001Z")!).toBe(1n);
 });
 it("maps saved bigint snapshots and historical allocations without live Inventory lookup",async()=>{
  mocks.abort.mockResolvedValueOnce({data:detail,error:null});
  expect(await getTestCalculation(id(2),"token")).toMatchObject({ok:true,value:{items:[{name:"Saved archived name",serialNumber:"007",required:"9223372036854775807",held:"9007199254740993",missing:"9214364837600034814",holds:[{quantity:"9007199254740993",warehouseCode:"raw_materials"}]}]}});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_test_calculation",{p_calculation_id:id(2)});
 });
 it("preserves saved holds after expiry and zero allocation remains an empty hold list",async()=>{
  const expired={...detail,status:"expired",expires_at:"2020-01-01T23:00:00Z",created_at:"2019-01-01T00:00:00Z",deadline_date:"2020-01-01"};
  mocks.abort.mockResolvedValueOnce({data:expired,error:null});expect(await getTestCalculation(id(2),"token")).toMatchObject({ok:true,value:{status:"expired",items:[{held:"9007199254740993"}]}});
  mocks.abort.mockResolvedValueOnce({data:{...detail,items:[{...detail.items[0],held_quantity:"0",missing_quantity:"9223372036854775807",holds:[]}]},error:null});
  expect(await getTestCalculation(id(2),"token")).toMatchObject({ok:true,value:{items:[{held:"0",holds:[]}]}});
 });
 it("rejects private-extra fields, wrong identity, malformed quantities and unsafe arithmetic",async()=>{
  for(const data of [{...detail,request_id:id(8)},{...detail,calculation_id:id(8)},{...detail,items:[{...detail.items[0],held_quantity:9007199254740993}]},
   {...detail,items:[{...detail.items[0],missing_quantity:"0"}]},{...detail,items:[{...detail.items[0],holds:[]}]},{...detail,status:"expired"}]){
   mocks.abort.mockResolvedValueOnce({data,error:null});expect((await getTestCalculation(id(2),"token")).ok).toBe(false);
  }
  for(const data of [[{...row,receipt:{}}],[row,row],[{...row,created_at:"invalid"}]]){mocks.abort.mockResolvedValueOnce({data,error:null});expect((await listTestCalculations(20,null,"token")).ok).toBe(false);}
 });
 it("rejects invalid cursors, non-descending pages and cursor replay before exposing any rows",async()=>{
  expect((await listTestCalculations(0,null,"token")).ok).toBe(false);expect((await listTestCalculations(20,{id:id(2),createdAt:"invalid"},"token")).ok).toBe(false);
  expect((await getTestCalculation("invalid","token")).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.abort.mockResolvedValueOnce({data:[row],error:null});expect((await listTestCalculations(20,{id:id(2),createdAt:row.created_at},"token")).ok).toBe(false);
  mocks.abort.mockResolvedValueOnce({data:[{...row,calculation_id:id(1)},row],error:null});expect((await listTestCalculations(20,null,"token")).ok).toBe(false);
 });
 it("reports denied, missing and network failures without leaking raw errors",async()=>{
  mocks.abort.mockResolvedValueOnce({data:detail,error:{code:"42501",message:"private"}});expect(await getTestCalculation(id(2),"token")).toMatchObject({ok:false,error:{code:"access_denied"}});
  mocks.abort.mockResolvedValueOnce({data:null,error:{code:"P0002"}});expect(await getTestCalculation(id(2),"token")).toMatchObject({ok:false,error:{code:"not_found"}});
  mocks.abort.mockRejectedValueOnce(new Error("private network"));expect(JSON.stringify(await listTestCalculations(20,null,"token"))).not.toContain("private network");
 });
});
