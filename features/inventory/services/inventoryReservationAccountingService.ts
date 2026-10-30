import {supabase} from "../../../lib/supabase/client";
import {frontendEnv} from "../../../lib/config/env";
import {isWorkOrderCommitmentReadsEnabled} from "../../../app/config/workOrderCommitmentReadsActivation";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
import {availabilityTimestamp,parseWorkOrderAvailability,type WorkOrderAvailability,type MaterialAvailability} from "../../work-orders/services/workOrderAvailabilityService";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";

export const inventoryReservationAccountingPrefix=(actor:string|undefined,profile:string|undefined)=>
  ["inventory-reservation-accounting",new URL(frontendEnv.supabaseUrl).origin,actor,profile] as const;
export const workOrderCommitmentStatusPrefix=(actor:string|undefined,profile:string|undefined)=>
  ["work-order-commitment-status",new URL(frontendEnv.supabaseUrl).origin,actor,profile] as const;
export interface InventoryReservationAccountingRow {
  productId:string;serialNumber:string;productName:string;isActive:boolean;
  physicalQuantity:string;scopePhysicalQuantity:string;projectDemand:string;fgReserved:string;testHeld:string;
  workOrderHeld:string;warehouseWorkOrderHeld:string;projectCoverage:string;availableAfterProjects:string;
  hardAvailable:string;netAvailableAfterAllCommitments:string;
}
export interface InventoryReservationAccounting {
  warehouseId:string;quantityScope:string;asOf:string;offset:number;limit:number;hasMore:boolean;items:InventoryReservationAccountingRow[];
}
export type WorkOrderCommitmentStatus=Omit<WorkOrderAvailability,"materials">&{
  materials:(MaterialAvailability&{held:string;uncovered:string;reservationInitialized:boolean})[];
};
export type AccountingResult<T>={ok:true;value:T}|{ok:false;error:{code:"access_denied"|"unavailable";message:string}};
const failure=<T>(denied=false):AccountingResult<T>=>({ok:false,error:{code:denied?"access_denied":"unavailable",message:"Commitment accounting unavailable"}});
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
const exact=(v:Record<string,unknown>,keys:string)=>Object.keys(v).sort().join()===keys.split(",").sort().join();
const decimal=(v:unknown,signed=false):v is string=>typeof v==="string"&&(signed?/^(?:0|-?[1-9][0-9]*)$/:/^(?:0|[1-9][0-9]*)$/).test(v);
const scopes:Record<string,string>={raw_materials:"raw_customs_planning",finished_goods:"finished_goods_reservations",customs:"customs_physical"};
const scopeFor=(id:string)=>scopes[INVENTORY_WAREHOUSES.find(w=>w.id===id)?.code??""];
const fields="product_id,serial_number,product_name,is_active,physical_quantity,scope_physical_quantity,project_demand_quantity,fg_reserved_quantity,test_held_quantity,work_order_held_quantity,warehouse_work_order_held_quantity,project_coverage_quantity,available_after_projects,hard_available_quantity,net_available_after_all_commitments";
export function parseInventoryReservationAccounting(data:unknown,warehouseId:string,limit:number,offset:number):AccountingResult<InventoryReservationAccounting>{
  const scope=scopeFor(warehouseId);
  if(!scope||!record(data)||!exact(data,"schema,warehouse_id,quantity_scope,as_of,offset,limit,has_more,items")||data.schema!==1||data.warehouse_id!==warehouseId||data.quantity_scope!==scope||
    availabilityTimestamp(data.as_of)===null||data.offset!==offset||data.limit!==limit||typeof data.has_more!=="boolean"||!Array.isArray(data.items)||data.items.length>limit||data.has_more&&data.items.length!==limit)return failure();
  const seen=new Set<string>(),items:InventoryReservationAccountingRow[]=[];
  for(const r of data.items){
    if(!record(r)||!exact(r,fields)||!testUuid(r.product_id)||seen.has(r.product_id)||typeof r.serial_number!=="string"||typeof r.product_name!=="string"||!r.product_name.trim()||typeof r.is_active!=="boolean")return failure();
    for(const key of fields.split(",").slice(4))if(!decimal(r[key],key==="available_after_projects"||key==="net_available_after_all_commitments"))return failure();
    const p=BigInt(r.physical_quantity as string),s=BigInt(r.scope_physical_quantity as string),d=BigInt(r.project_demand_quantity as string),f=BigInt(r.fg_reserved_quantity as string),t=BigInt(r.test_held_quantity as string),w=BigInt(r.work_order_held_quantity as string),wh=BigInt(r.warehouse_work_order_held_quantity as string),hard=s-f-t-w;
    if(p>9223372036854775807n||r.project_coverage_quantity!=="0"||s<p||w<wh||scope!=="raw_customs_planning"&&(s!==p||wh!==w||d!==0n)||scope!=="finished_goods_reservations"&&f!==0n||
      BigInt(r.available_after_projects as string)!==s-d-f||BigInt(r.net_available_after_all_commitments as string)!==s-d-f-t-w||BigInt(r.hard_available_quantity as string)!==(hard>0n?hard:0n))return failure();
    seen.add(r.product_id);items.push({productId:r.product_id,serialNumber:r.serial_number,productName:r.product_name,isActive:r.is_active,
      physicalQuantity:r.physical_quantity as string,scopePhysicalQuantity:r.scope_physical_quantity as string,projectDemand:r.project_demand_quantity as string,
      fgReserved:r.fg_reserved_quantity as string,testHeld:r.test_held_quantity as string,workOrderHeld:r.work_order_held_quantity as string,
      warehouseWorkOrderHeld:r.warehouse_work_order_held_quantity as string,projectCoverage:"0",availableAfterProjects:r.available_after_projects as string,
      hardAvailable:r.hard_available_quantity as string,netAvailableAfterAllCommitments:r.net_available_after_all_commitments as string});
  }
  return{ok:true,value:{warehouseId,quantityScope:scope,asOf:data.as_of as string,offset,limit,hasMore:data.has_more,items}};
}
export function parseWorkOrderCommitmentStatus(data:unknown,id:string):AccountingResult<WorkOrderCommitmentStatus>{
  if(!record(data)||!Array.isArray(data.materials))return failure();
  const quantities=new Map<string,{held:string;uncovered:string;reservationInitialized:boolean}>(),stripped=[];
  for(const r of data.materials){if(!record(r)||!testUuid(r.product_id)||!decimal(r.held_quantity)||!decimal(r.uncovered_quantity)||!decimal(r.required_quantity)||typeof r.reservation_initialized!=="boolean"||
    BigInt(r.required_quantity)!==BigInt(r.held_quantity)+BigInt(r.uncovered_quantity)||!r.reservation_initialized&&r.held_quantity!=="0")return failure();
    quantities.set(r.product_id,{held:r.held_quantity,uncovered:r.uncovered_quantity,reservationInitialized:r.reservation_initialized});
    const {held_quantity,uncovered_quantity,reservation_initialized,...base}=r;stripped.push(base);
  }
  const parsed=parseWorkOrderAvailability({...data,materials:stripped},id);return parsed.ok?{ok:true,value:{...parsed.value,materials:parsed.value.materials.map(m=>({...m,...quantities.get(m.productId)!}))}}:failure();
}
async function load<T>(rpc:string,args:Record<string,unknown>,token:string,parse:(data:unknown)=>AccountingResult<T>,signal?:AbortSignal):Promise<AccountingResult<T>>{
  if(!isWorkOrderCommitmentReadsEnabled()||!token||signal?.aborted)return failure(true);
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15000);signal?.addEventListener("abort",abort,{once:true});
  try{const {data,error}=await supabase.rpc(rpc,args).setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);return controller.signal.aborted?failure():error?failure(error.code==="42501"):parse(data);}
  catch{return failure();}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
export function getInventoryReservationAccounting(warehouseId:string,search:string,token:string,active:boolean|null=true,limit=100,offset=0,signal?:AbortSignal){
  if(!scopeFor(warehouseId)||search.length>200||!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0||offset>1000000)return Promise.resolve(failure<InventoryReservationAccounting>());
  return load("get_inventory_reservation_accounting",{p_warehouse_id:warehouseId,p_search:search.trim()||null,p_active:active,p_limit:limit,p_offset:offset},token,data=>parseInventoryReservationAccounting(data,warehouseId,limit,offset),signal);
}
export function getWorkOrderCommitmentStatus(id:string,token:string,signal?:AbortSignal){return testUuid(id)?load("get_work_order_material_commitment_status",{p_work_order_id:id},token,data=>parseWorkOrderCommitmentStatus(data,id),signal):Promise.resolve(failure<WorkOrderCommitmentStatus>());}
