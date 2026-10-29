import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import { supabase } from "../../../lib/supabase/client";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";

export const stockHealthStatuses = ["HEALTHY", "LOW_STOCK", "OUT_OF_STOCK", "NOT_CONFIGURED"] as const;
export type StockHealthStatus = typeof stockHealthStatuses[number];
export interface InventoryStockHealth {
  productId: string; warehouseId: string; productName: string; isActive: boolean;
  physicalQuantity: string; minimumQuantity: string | null; version: string | null; status: StockHealthStatus;
}
export type StockHealthResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export const stockHealthFailure = <T,>(code = "unavailable"): StockHealthResult<T> => ({ ok: false, error: { code,
  message: code === "conflict" ? "This minimum changed. Refresh and review the current version before trying again." :
    code === "access_denied" ? "You do not have permission to access this warehouse minimum." :
    "Stock health could not be verified. Refresh before making another change.",
} });
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export const stockHealthDecimal = (v: unknown, positive = false): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 19 &&
  BigInt(v) <= 9223372036854775807n && (!positive || BigInt(v) > 0n);
export function validStockMinimum(v: string): boolean { return stockHealthDecimal(v, true); }

async function request(name: string, args: Record<string, unknown>, token: string, signal?: AbortSignal) {
  const controller = new AbortController(), abort = () => controller.abort();
  const timer = setTimeout(abort, 15_000);signal?.addEventListener("abort",abort,{ once:true });
  if(signal?.aborted)abort();
  try { return await supabase.rpc(name,args).setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal); }
  finally { clearTimeout(timer);signal?.removeEventListener("abort",abort); }
}
export async function getInventoryStockHealth(warehouseId: string, search: string, status: StockHealthStatus | null, token: string, signal?: AbortSignal): Promise<StockHealthResult<InventoryStockHealth[]>> {
  const warehouse=INVENTORY_WAREHOUSES.find(w=>w.id===warehouseId);
  if(!isInventoryStockHealthEnabled() || !warehouse || !token)return stockHealthFailure("access_denied");
  if(search.trim().length>200 || (status!==null && !stockHealthStatuses.includes(status)))return stockHealthFailure();
  const rows:InventoryStockHealth[]=[],ids=new Set<string>();
  try {
    // Preserve the existing full Product list/order while reading bounded pages.
    // Fail closed rather than silently truncate an exceptionally large catalog.
    for(let page=0;page<100;page++){
      if(signal?.aborted)return stockHealthFailure();
      const {data,error}=await request("get_inventory_stock_health",{p_warehouse_id:warehouseId,p_search:search.trim()||null,
        p_health_status:status,p_active:null,p_limit:200,p_offset:page*200},token,signal);
      if(error)return stockHealthFailure(error.code==="42501"?"access_denied":"unavailable");
      if(!Array.isArray(data)||data.length>200)return stockHealthFailure();
      for(const r of data){
        if(!r||!uuid(r.product_id)||ids.has(r.product_id)||r.warehouse_id!==warehouseId||r.warehouse_code!==warehouse.code||
          typeof r.product_name!=="string"||typeof r.serial_number!=="string"||typeof r.warehouse_name!=="string"||typeof r.is_active!=="boolean"||
          !stockHealthDecimal(r.physical_quantity)||(r.minimum_quantity!==null&&!stockHealthDecimal(r.minimum_quantity,true))||
          (r.configuration_version!==null&&!stockHealthDecimal(r.configuration_version,true))||
          (r.configuration_version===null&&r.minimum_quantity!==null)||!stockHealthStatuses.includes(r.health_status)||
          (status!==null&&r.health_status!==status))return stockHealthFailure();
        ids.add(r.product_id);rows.push({productId:r.product_id,warehouseId,productName:r.product_name,isActive:r.is_active,
          physicalQuantity:r.physical_quantity,minimumQuantity:r.minimum_quantity,version:r.configuration_version,status:r.health_status});
      }
      if(data.length<200)return {ok:true,value:rows};
    }
  }catch { /* Redacted transport/contract failure; never fabricate values. */ }
  return stockHealthFailure();
}
export interface StockMinimumConfiguration { productId: string; warehouseId: string; minimumQuantity: string | null; version: string }
export async function setInventoryStockMinimum(productId: string,warehouseId: string,minimum: string|null,version: string|null,token: string): Promise<StockHealthResult<StockMinimumConfiguration>> {
  if(!isInventoryStockHealthEnabled()||!token||!uuid(productId)||!INVENTORY_WAREHOUSES.some(w=>w.id===warehouseId))return stockHealthFailure("access_denied");
  if((minimum!==null&&!validStockMinimum(minimum))||(version!==null&&!stockHealthDecimal(version,true)))return stockHealthFailure("invalid");
  try{
    const {data,error}=await request("set_inventory_stock_minimum",{p_product_id:productId,p_warehouse_id:warehouseId,p_minimum_quantity:minimum,p_expected_version:version},token);
    if(error)return stockHealthFailure(error.code==="ISM01"?"conflict":error.code==="42501"?"access_denied":"unavailable");
    const r=Array.isArray(data)&&data.length===1?data[0]:null;
    if(!r||r.product_id!==productId||r.warehouse_id!==warehouseId||r.minimum_quantity!==minimum||!stockHealthDecimal(r.version,true)||
      BigInt(r.version)!==(version===null?1n:BigInt(version)+1n)||typeof r.created_at!=="string"||typeof r.updated_at!=="string"||
      !Number.isFinite(Date.parse(r.created_at))||!Number.isFinite(Date.parse(r.updated_at)))return stockHealthFailure();
    return {ok:true,value:{productId,warehouseId,minimumQuantity:minimum,version:r.version}};
  }catch{return stockHealthFailure();}
}
