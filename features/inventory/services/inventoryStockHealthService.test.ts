import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),header:vi.fn(),abort:vi.fn(),gate:vi.fn()}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:mocks.gate}));
import { getInventoryStockHealth, setInventoryStockMinimum, validStockMinimum } from "./inventoryStockHealthService";
const raw="10000000-0000-4000-8000-000000000001",id="00000000-0000-4000-8000-000000000001";
const row={product_id:id,serial_number:"001",product_name:"Product",is_active:true,warehouse_id:raw,warehouse_code:"raw_materials",warehouse_name:"Raw Materials",
  physical_quantity:"9007199254740993",minimum_quantity:"9223372036854775807",configuration_version:"9007199254740993",health_status:"LOW_STOCK"};
const saved={product_id:id,warehouse_id:raw,minimum_quantity:"9223372036854775807",version:"9007199254740994",created_at:"2026-10-28T00:00:00Z",updated_at:"2026-10-28T00:00:01Z"};
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockReturnValue(true);const chain={setHeader:mocks.header,abortSignal:mocks.abort};mocks.rpc.mockReturnValue(chain);mocks.header.mockReturnValue(chain);mocks.abort.mockResolvedValue({data:[row],error:null});});
it("reads only bounded trusted pages with exact warehouse/search/filter scope and actor token",async()=>{
  expect(await getInventoryStockHealth(raw,"  Product ","LOW_STOCK","memory-token")).toMatchObject({ok:true,value:[{physicalQuantity:row.physical_quantity,minimumQuantity:row.minimum_quantity,version:row.configuration_version,status:"LOW_STOCK"}]});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_inventory_stock_health",{p_warehouse_id:raw,p_search:"Product",p_health_status:"LOW_STOCK",p_active:null,p_limit:200,p_offset:0});
  expect(mocks.header).toHaveBeenCalledWith("Authorization","Bearer memory-token");expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it.each([["10000000-0000-4000-8000-000000000002","finished_goods"],["10000000-0000-4000-8000-000000000003","customs"]])("keeps %s health scoped to its own warehouse",async(warehouseId,code)=>{
  mocks.abort.mockResolvedValue({data:[{...row,warehouse_id:warehouseId,warehouse_code:code}],error:null});
  expect(await getInventoryStockHealth(warehouseId,"",null,"token")).toMatchObject({ok:true,value:[{warehouseId,physicalQuantity:row.physical_quantity}]});
});
it("reads subsequent pages without changing quantities or truncating to the first page",async()=>{
  const page=Array.from({length:200},(_,n)=>({...row,product_id:`00000000-0000-4000-8000-${String(n+1).padStart(12,"0")}`}));
  mocks.abort.mockResolvedValueOnce({data:page,error:null}).mockResolvedValueOnce({data:[],error:null});
  expect(await getInventoryStockHealth(raw,"",null,"token")).toMatchObject({ok:true,value:expect.any(Array)});
  expect(mocks.rpc.mock.calls[1]![1].p_offset).toBe(200);
});
it.each(["0","-1","1.5","1e3",""," 1","9223372036854775808"])("rejects invalid minimum %s",value=>expect(validStockMinimum(value)).toBe(false));
it("preserves bigint set payload and expected version exactly",async()=>{
  mocks.abort.mockResolvedValue({data:[saved],error:null});
  expect(await setInventoryStockMinimum(id,raw,saved.minimum_quantity,row.configuration_version,"token")).toMatchObject({ok:true,value:{minimumQuantity:saved.minimum_quantity,version:saved.version}});
  expect(mocks.rpc).toHaveBeenCalledWith("set_inventory_stock_minimum",{p_product_id:id,p_warehouse_id:raw,p_minimum_quantity:saved.minimum_quantity,p_expected_version:row.configuration_version});
});
it("supports first set and explicit clear without replacing null versions with zero",async()=>{
  mocks.abort.mockResolvedValueOnce({data:[{...saved,version:"1",minimum_quantity:"5"}],error:null});
  expect((await setInventoryStockMinimum(id,raw,"5",null,"token")).ok).toBe(true);
  mocks.abort.mockResolvedValueOnce({data:[{...saved,version:"2",minimum_quantity:null}],error:null});
  expect(await setInventoryStockMinimum(id,raw,null,"1","token")).toMatchObject({ok:true,value:{minimumQuantity:null,version:"2"}});
});
it.each([{physical_quantity:9007199254740993},{minimum_quantity:"0"},{configuration_version:1},{health_status:"Unknown"},{warehouse_id:id}])("fails closed on malformed read %j",async patch=>{
  mocks.abort.mockResolvedValue({data:[{...row,...patch}],error:null});expect((await getInventoryStockHealth(raw,"",null,"token")).ok).toBe(false);
});
it("rejects duplicate pagination identities and preserves empty results",async()=>{
  mocks.abort.mockResolvedValueOnce({data:[row,row],error:null});expect((await getInventoryStockHealth(raw,"",null,"token")).ok).toBe(false);
  mocks.abort.mockResolvedValueOnce({data:[],error:null});expect(await getInventoryStockHealth(raw,"",null,"token")).toEqual({ok:true,value:[]});
});
it("reports stale versions, denied access and malformed/uncertain success without false success",async()=>{
  mocks.abort.mockResolvedValueOnce({data:null,error:{code:"ISM01",message:"private detail"}});
  expect(await setInventoryStockMinimum(id,raw,"5","1","token")).toMatchObject({ok:false,error:{code:"conflict"}});
  mocks.abort.mockResolvedValueOnce({data:null,error:{code:"42501"}});expect(await getInventoryStockHealth(raw,"",null,"token")).toMatchObject({ok:false,error:{code:"access_denied"}});
  mocks.abort.mockResolvedValueOnce({data:[{...saved,version:2}],error:null});expect((await setInventoryStockMinimum(id,raw,"5","1","token")).ok).toBe(false);
  mocks.abort.mockRejectedValueOnce(new Error("secret"));expect(JSON.stringify(await setInventoryStockMinimum(id,raw,"5","1","token"))).not.toContain("secret");
});
it("gate OFF prevents both reads and writes, including forced direct service calls",async()=>{
  mocks.gate.mockReturnValue(false);await getInventoryStockHealth(raw,"",null,"token");await setInventoryStockMinimum(id,raw,"5",null,"token");expect(mocks.rpc).not.toHaveBeenCalled();
});
