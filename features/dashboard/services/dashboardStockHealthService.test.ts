import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),header:vi.fn(),abort:vi.fn(),gate:vi.fn()}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:mocks.gate}));
import { getDashboardStockHealth } from "./dashboardStockHealthService";
const raw="10000000-0000-4000-8000-000000000001",fg="10000000-0000-4000-8000-000000000002";
const warehouse={warehouse_id:raw,warehouse_code:"raw_materials",warehouse_name:"Raw Materials",product_count:"9007199254740996",healthy_count:"9007199254740993",low_stock_count:"1",out_of_stock_count:"1",not_configured_count:"1"};
const item={product_id:"00000000-0000-4000-8000-000000000001",serial_number:"001",product_name:"Last name but out first",warehouse_id:raw,warehouse_code:"raw_materials",warehouse_name:"Raw Materials",physical_quantity:"0",minimum_quantity:"9223372036854775807",health_status:"OUT_OF_STOCK",configuration_version:"9007199254740993"};
const result={as_of:"2026-10-28T09:00:00.123456Z",warehouses:[warehouse],critical_items:[item]};
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockReturnValue(true);const chain={setHeader:mocks.header,abortSignal:mocks.abort};mocks.rpc.mockReturnValue(chain);mocks.header.mockReturnValue(chain);mocks.abort.mockResolvedValue({data:result,error:null});});
it("uses the single trusted bounded RPC and preserves exact counts, quantities and backend order",async()=>{
  const second={...item,product_id:"00000000-0000-4000-8000-000000000002",product_name:"Alphabetically first low stock",physical_quantity:"9007199254740993",health_status:"LOW_STOCK"};
  mocks.abort.mockResolvedValue({data:{...result,critical_items:[item,second]},error:null});
  expect(await getDashboardStockHealth("memory-token")).toMatchObject({ok:true,value:{warehouses:[{productCount:warehouse.product_count,healthyCount:warehouse.healthy_count}],criticalItems:[{productName:item.product_name,physicalQuantity:"0",minimumQuantity:item.minimum_quantity},{productName:second.product_name,physicalQuantity:second.physical_quantity}]}});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_dashboard_stock_health",{p_critical_limit:10});expect(mocks.header).toHaveBeenCalledWith("Authorization","Bearer memory-token");expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("preserves omitted warehouses and legitimate empty results without manufacturing zero rows",async()=>{
  mocks.abort.mockResolvedValue({data:{...result,warehouses:[],critical_items:[]},error:null});expect(await getDashboardStockHealth("token")).toMatchObject({ok:true,value:{warehouses:[],criticalItems:[]}});
});
it("counts one Product separately in two authorized warehouses",async()=>{
  const output={...warehouse,warehouse_id:fg,warehouse_code:"finished_goods",warehouse_name:"Finished Goods"};
  mocks.abort.mockResolvedValue({data:{...result,warehouses:[warehouse,output],critical_items:[item,{...item,warehouse_id:fg,warehouse_code:output.warehouse_code,warehouse_name:output.warehouse_name}]},error:null});
  expect(await getDashboardStockHealth("token")).toMatchObject({ok:true,value:{warehouses:expect.any(Array),criticalItems:[{productId:item.product_id,warehouseId:raw},{productId:item.product_id,warehouseId:fg}]}});
});
it.each([{product_count:2},{healthy_count:"-1"},{not_configured_count:"0"},{warehouse_id:"unknown"}])("rejects malformed/count-inconsistent summaries %j",async patch=>{
  mocks.abort.mockResolvedValue({data:{...result,warehouses:[{...warehouse,...patch}]},error:null});expect((await getDashboardStockHealth("token")).ok).toBe(false);
});
it.each([{warehouse_id:fg},{physical_quantity:1},{minimum_quantity:"0"},{health_status:"HEALTHY"},{physical_quantity:"1",health_status:"OUT_OF_STOCK"}])("rejects unauthorized or invalid attention rows %j",async patch=>{
  mocks.abort.mockResolvedValue({data:{...result,critical_items:[{...item,...patch}]},error:null});expect((await getDashboardStockHealth("token")).ok).toBe(false);
});
it("rejects duplicate pairs, malformed timestamps and oversized results",async()=>{
  for(const data of [{...result,critical_items:[item,item]},{...result,as_of:"bad"},{...result,critical_items:Array(11).fill(item)}]){
    mocks.abort.mockResolvedValueOnce({data,error:null});expect((await getDashboardStockHealth("token")).ok).toBe(false);
  }
});
it("gate OFF and missing token prevent RPCs",async()=>{mocks.gate.mockReturnValue(false);await getDashboardStockHealth("token");mocks.gate.mockReturnValue(true);await getDashboardStockHealth("");expect(mocks.rpc).not.toHaveBeenCalled();});
it("redacts transport failures and preserves permission denial without fake zeros",async()=>{
  mocks.abort.mockResolvedValueOnce({data:null,error:{code:"42501",message:"sensitive"}});expect(await getDashboardStockHealth("token")).toMatchObject({ok:false,error:{code:"access_denied"}});
  mocks.abort.mockRejectedValueOnce(Error("secret"));const failed=await getDashboardStockHealth("token");expect(failed.ok).toBe(false);expect(JSON.stringify(failed)).not.toContain("secret");
});
