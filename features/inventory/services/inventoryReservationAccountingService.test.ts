import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({enabled:false,rpc:vi.fn(),header:vi.fn(),abort:vi.fn()}));
vi.mock("../../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>mocks.enabled}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
import {getInventoryReservationAccounting,getWorkOrderCommitmentStatus,parseInventoryReservationAccounting,parseWorkOrderCommitmentStatus,inventoryReservationAccountingPrefix,workOrderCommitmentStatusPrefix} from "./inventoryReservationAccountingService";
const raw="10000000-0000-4000-8000-000000000001",fg="10000000-0000-4000-8000-000000000002",customs="10000000-0000-4000-8000-000000000003",product="00000000-0000-4000-8000-000000000001",wo="00000000-0000-4000-8000-000000000002";
const row={product_id:product,serial_number:"8000001",product_name:"Owned material",is_active:true,physical_quantity:"5",scope_physical_quantity:"9",project_demand_quantity:"10",fg_reserved_quantity:"0",test_held_quantity:"0",work_order_held_quantity:"7",warehouse_work_order_held_quantity:"5",project_coverage_quantity:"0",available_after_projects:"-1",hard_available_quantity:"2",net_available_after_all_commitments:"-8"};
const envelope={schema:1,warehouse_id:raw,quantity_scope:"raw_customs_planning",as_of:"2026-10-30T10:00:00.123456Z",offset:0,limit:100,has_more:false,items:[row]};
const material={product_id:product,serial_number:"8000001",product_name:"Owned material",product_is_active:true,required_quantity:"9007199254740994",eligible_quantity:"9007199254740990",missing_quantity:"4",has_shortage:true,held_quantity:"9007199254740990",uncovered_quantity:"4",reservation_initialized:true};
const status={work_order_id:wo,work_order_number:"RN-2026-0041",status:"draft",updated_at:envelope.as_of,as_of:envelope.as_of,materials:[material]};
beforeEach(()=>{vi.resetAllMocks();mocks.enabled=false;const chain={setHeader:mocks.header,abortSignal:mocks.abort};mocks.rpc.mockReturnValue(chain);mocks.header.mockReturnValue(chain);});
it("gate OFF invokes neither undeployed accounting RPC",async()=>{
  expect((await getInventoryReservationAccounting(raw,"","token")).ok).toBe(false);expect((await getWorkOrderCommitmentStatus(wo,"token")).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
});
it("keeps demand and held stock distinct and preserves signed net availability",()=>{
  expect(parseInventoryReservationAccounting(envelope,raw,100,0)).toMatchObject({ok:true,value:{quantityScope:"raw_customs_planning",items:[{physicalQuantity:"5",scopePhysicalQuantity:"9",projectDemand:"10",workOrderHeld:"7",warehouseWorkOrderHeld:"5",projectCoverage:"0",hardAvailable:"2",netAvailableAfterAllCommitments:"-8"}]}});
});
it("preserves quantities above JavaScript integer precision",()=>{
  const big={...row,physical_quantity:"9007199254740994",scope_physical_quantity:"9007199254741002",project_demand_quantity:"0",work_order_held_quantity:"9007199254740994",warehouse_work_order_held_quantity:"9007199254740994",available_after_projects:"9007199254741002",hard_available_quantity:"8",net_available_after_all_commitments:"8"};
  expect(parseInventoryReservationAccounting({...envelope,items:[big]},raw,100,0)).toMatchObject({ok:true,value:{items:[{workOrderHeld:"9007199254740994",netAvailableAfterAllCommitments:"8"}]}});
});
it.each([{work_order_held_quantity:7},{project_coverage_quantity:"1"},{work_order_held_quantity:"-1"},{test_held_quantity:"01"},{hard_available_quantity:"3"},{net_available_after_all_commitments:"-0"},{available_after_projects:"0"},{warehouse_work_order_held_quantity:"8"},{physical_quantity:"9223372036854775808"},{private_owner:"secret"}])("fails closed on malformed/inconsistent Inventory quantities %j",patch=>{
  expect(parseInventoryReservationAccounting({...envelope,items:[{...row,...patch}]},raw,100,0).ok).toBe(false);
});
it.each([{warehouse_id:fg},{quantity_scope:"customs_physical"},{as_of:"bad"},{offset:1},{limit:101},{has_more:true},{private_events:[]}])("rejects mismatched snapshots/pagination/private fields %j",patch=>{
  expect(parseInventoryReservationAccounting({...envelope,...patch},raw,100,0).ok).toBe(false);
});
it("rejects duplicate Product/warehouse pairs and accepts an authoritative empty page",()=>{
  expect(parseInventoryReservationAccounting({...envelope,items:[row,row]},raw,100,0).ok).toBe(false);expect(parseInventoryReservationAccounting({...envelope,items:[]},raw,100,0)).toMatchObject({ok:true,value:{items:[]}});
});
it.each([[fg,"finished_goods_reservations"],[customs,"customs_physical"]])("parses single-warehouse scope %s without combining quantities",(warehouse,scope)=>{
  const single={...row,scope_physical_quantity:"5",project_demand_quantity:"0",work_order_held_quantity:"2",warehouse_work_order_held_quantity:"2",available_after_projects:"5",hard_available_quantity:"3",net_available_after_all_commitments:"3"};expect(parseInventoryReservationAccounting({...envelope,warehouse_id:warehouse,quantity_scope:scope,items:[single]},warehouse,100,0).ok).toBe(true);
});
it("parses Required/Held/Uncovered separately from observed production shortage",()=>{
  expect(parseWorkOrderCommitmentStatus(status,wo)).toMatchObject({ok:true,value:{materials:[{required:"9007199254740994",held:"9007199254740990",uncovered:"4",eligible:"9007199254740990",missing:"4",reservationInitialized:true}]}});
  expect(parseWorkOrderCommitmentStatus({...status,materials:[{...material,held_quantity:"0",uncovered_quantity:material.required_quantity,reservation_initialized:false}]},wo).ok).toBe(true);
});
it.each([{held_quantity:"9007199254740994"},{held_quantity:9007199254740990},{reservation_initialized:false},{uncovered_quantity:"3"},{has_shortage:false},{private_state:[]}])("rejects unsafe Work Order material metadata %j",patch=>{
  expect(parseWorkOrderCommitmentStatus({...status,materials:[{...material,...patch}]},wo).ok).toBe(false);
});
it("uses bounded trusted RPCs with actor token/cancellation and no direct table reads",async()=>{
  mocks.enabled=true;mocks.abort.mockResolvedValueOnce({data:envelope,error:null});expect((await getInventoryReservationAccounting(raw,"  item  ","memory-token")).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("get_inventory_reservation_accounting",{p_warehouse_id:raw,p_search:"item",p_active:true,p_limit:100,p_offset:0});expect(mocks.header).toHaveBeenCalledWith("Authorization","Bearer memory-token");expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
  mocks.abort.mockResolvedValueOnce({data:status,error:null});expect((await getWorkOrderCommitmentStatus(wo,"memory-token")).ok).toBe(true);expect(mocks.rpc).toHaveBeenCalledWith("get_work_order_material_commitment_status",{p_work_order_id:wo});
});
it("keeps unavailable/denied reads unavailable and rejects invalid requests locally",async()=>{
  mocks.enabled=true;mocks.abort.mockResolvedValueOnce({data:null,error:{code:"42501",message:"private"}});expect(await getInventoryReservationAccounting(raw,"","token")).toMatchObject({ok:false,error:{code:"access_denied"}});
  mocks.abort.mockRejectedValueOnce(Error("secret response"));expect(JSON.stringify(await getWorkOrderCommitmentStatus(wo,"token"))).not.toContain("secret response");
  mocks.rpc.mockClear();await getInventoryReservationAccounting(raw,"","token",true,201);await getInventoryReservationAccounting("invalid","","token");await getWorkOrderCommitmentStatus("invalid","token");expect(mocks.rpc).not.toHaveBeenCalled();
});
it("scopes new cache prefixes by backend, actor and profile",()=>{
  expect(inventoryReservationAccountingPrefix("actor-a","profile-a")).not.toEqual(inventoryReservationAccountingPrefix("actor-b","profile-a"));expect(inventoryReservationAccountingPrefix("actor-a","profile-a")).not.toEqual(inventoryReservationAccountingPrefix("actor-a","profile-b"));
  expect(workOrderCommitmentStatusPrefix("actor-a","profile-a")[1]).toMatch(/^https?:\/\//);expect(workOrderCommitmentStatusPrefix("actor-a","profile-a")[0]).not.toBe(inventoryReservationAccountingPrefix("actor-a","profile-a")[0]);
});
