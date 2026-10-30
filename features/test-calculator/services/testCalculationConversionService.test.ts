import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({gate:vi.fn(),rpc:vi.fn()}));
vi.mock("../../../app/config/testCalculationImportActivation",()=>({isTestCalculationImportEnabled:mocks.gate}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
import {getTestConversions,parseTestConversions} from "./testCalculationConversionService";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const row={calculation_id:id(1),imported:true,can_navigate:true,destination:{calculator_id:id(2),product_id:id(3),serial_number:"006",imported_at:"2026-10-29T11:00:00.123456Z"},items:[]};
const response={as_of:"2026-10-30T00:00:00Z",next_expiry:null,rows:[row]};
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockReturnValue(true);});
it("preserves leading zeros and redacts denied destinations rather than leaking a link",()=>{
  expect(parseTestConversions(response,[id(1)])).toEqual(response);
  const denied={...response,rows:[{...row,can_navigate:false,destination:null}]};expect(parseTestConversions(denied,[id(1)])).toEqual(denied);
  expect(parseTestConversions({...response,rows:[{...row,can_navigate:false}]},[id(1)])).toBeNull();
});
it("strictly verifies exact commitment strings and warehouse totals",()=>{
  const item={item_id:id(4),product_id:id(5),effective_quantity:"9007199254740993",warehouses:[{warehouse_id:"10000000-0000-4000-8000-000000000001",quantity:"9007199254740993"}]};
  expect(parseTestConversions({...response,rows:[{...row,items:[item]}]},[id(1)],true)?.rows[0]?.items[0]?.effective_quantity).toBe("9007199254740993");
  expect(parseTestConversions({...response,rows:[{...row,items:[{...item,effective_quantity:"0"}]}]},[id(1)],true)).toBeNull();
  expect(parseTestConversions({...response,rows:[{...row,items:[{...item,effective_quantity:1}]}]},[id(1)],true)).toBeNull();
});
it.each([{rows:[]},{private_receipt:{}},{rows:[{...row,imported:false}]},{next_expiry:"2020-01-01T00:00:00Z"}])("rejects incomplete or unsafe metadata %j",patch=>{
  expect(parseTestConversions({...response,...patch},[id(1)])).toBeNull();
});
it("gate OFF makes no RPC even with explicit service calls",async()=>{mocks.gate.mockReturnValue(false);await expect(getTestConversions([id(1)],"token")).rejects.toThrow(/unavailable/);expect(mocks.rpc).not.toHaveBeenCalled();});
it("calls only the bounded authorized RPC and fails closed on malformed responses",async()=>{
  const abortSignal=vi.fn().mockResolvedValue({data:response,error:null}),header=vi.fn().mockReturnValue({abortSignal});mocks.rpc.mockReturnValue({setHeader:header});
  expect(await getTestConversions([id(1)],"token")).toEqual(response);expect(mocks.rpc).toHaveBeenCalledWith("get_test_calculation_conversions",{p_calculation_ids:[id(1)],p_include_commitments:false});
  abortSignal.mockResolvedValue({data:{},error:null});await expect(getTestConversions([id(1)],"token")).rejects.toThrow(/unavailable/);
});
