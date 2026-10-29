import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import { supabase } from "../../../lib/supabase/client";
import { INVENTORY_WAREHOUSES, type InventoryWarehouseCode } from "../../inventory/inventoryWarehouses";
import { stockHealthDecimal } from "../../inventory/services/inventoryStockHealthService";

export interface WarehouseStockHealth {
  warehouseId: string; warehouseCode: InventoryWarehouseCode; warehouseName: string;
  productCount: string; healthyCount: string; lowStockCount: string; outOfStockCount: string; notConfiguredCount: string;
}
export interface CriticalInventoryItem {
  productId: string; serialNumber: string; productName: string; warehouseId: string;
  warehouseCode: InventoryWarehouseCode; warehouseName: string; physicalQuantity: string;
  minimumQuantity: string; version: string; status: "LOW_STOCK"|"OUT_OF_STOCK";
}
export interface DashboardStockHealth { asOf: string; warehouses: WarehouseStockHealth[]; criticalItems: CriticalInventoryItem[] }
export type DashboardStockHealthResult={ok:true;value:DashboardStockHealth}|{ok:false;error:{code:"access_denied"|"unavailable";message:string}};
export const dashboardHealthFailure=(denied=false):DashboardStockHealthResult=>({ok:false,error:{code:denied?"access_denied":"unavailable",
  message:denied?"Stock health access is denied.":"Warehouse stock health could not be verified. No counts or stock values are assumed."}});
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export async function getDashboardStockHealth(token:string,signal?:AbortSignal,criticalLimit=10):Promise<DashboardStockHealthResult>{
  if(!isInventoryStockHealthEnabled()||!token)return dashboardHealthFailure(true);
  if(!Number.isInteger(criticalLimit)||criticalLimit<1||criticalLimit>100)return dashboardHealthFailure();
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15_000);
  signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  try{
    const {data,error}=await supabase.rpc("get_dashboard_stock_health",{p_critical_limit:criticalLimit})
      .setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);
    if(error)return dashboardHealthFailure(error.code==="42501");
    if(!data||typeof data.as_of!=="string"||!Number.isFinite(Date.parse(data.as_of))||!Array.isArray(data.warehouses)||
      data.warehouses.length>3||!Array.isArray(data.critical_items)||data.critical_items.length>criticalLimit)return dashboardHealthFailure();
    const warehouses:WarehouseStockHealth[]=[],criticalItems:CriticalInventoryItem[]=[],ids=new Set<string>(),pairs=new Set<string>();
    for(const r of data.warehouses){
      const known=INVENTORY_WAREHOUSES.find(w=>w.id===r?.warehouse_id);
      if(!known||ids.has(known.id)||r.warehouse_code!==known.code||typeof r.warehouse_name!=="string"||
        ![r.product_count,r.healthy_count,r.low_stock_count,r.out_of_stock_count,r.not_configured_count].every(v=>stockHealthDecimal(v))||
        BigInt(r.product_count)!==BigInt(r.healthy_count)+BigInt(r.low_stock_count)+BigInt(r.out_of_stock_count)+BigInt(r.not_configured_count))return dashboardHealthFailure();
      ids.add(known.id);warehouses.push({warehouseId:known.id,warehouseCode:known.code,warehouseName:r.warehouse_name,
        productCount:r.product_count,healthyCount:r.healthy_count,lowStockCount:r.low_stock_count,outOfStockCount:r.out_of_stock_count,notConfiguredCount:r.not_configured_count});
    }
    for(const r of data.critical_items){
      const warehouse=warehouses.find(w=>w.warehouseId===r?.warehouse_id),pair=`${r?.warehouse_id}:${r?.product_id}`;
      if(!warehouse||!uuid(r.product_id)||pairs.has(pair)||r.warehouse_code!==warehouse.warehouseCode||r.warehouse_name!==warehouse.warehouseName||
        typeof r.product_name!=="string"||typeof r.serial_number!=="string"||!stockHealthDecimal(r.physical_quantity)||!stockHealthDecimal(r.minimum_quantity,true)||
        !stockHealthDecimal(r.configuration_version,true)||!["OUT_OF_STOCK","LOW_STOCK"].includes(r.health_status))return dashboardHealthFailure();
      // Validate the contract; do not derive or replace authoritative statuses.
      if((r.health_status==="OUT_OF_STOCK"&&r.physical_quantity!=="0")||
        (r.health_status==="LOW_STOCK"&&(r.physical_quantity==="0"||BigInt(r.physical_quantity)>=BigInt(r.minimum_quantity))))return dashboardHealthFailure();
      pairs.add(pair);criticalItems.push({productId:r.product_id,serialNumber:r.serial_number,productName:r.product_name,warehouseId:warehouse.warehouseId,
        warehouseCode:warehouse.warehouseCode,warehouseName:warehouse.warehouseName,physicalQuantity:r.physical_quantity,minimumQuantity:r.minimum_quantity,version:r.configuration_version,status:r.health_status});
    }
    return {ok:true,value:{asOf:data.as_of,warehouses,criticalItems}};
  }catch{return dashboardHealthFailure();}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
