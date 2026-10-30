import {supabase} from "../../../lib/supabase/client";
import {frontendEnv} from "../../../lib/config/env";
import {isWorkOrderCommitmentReadsEnabled} from "../../../app/config/workOrderCommitmentReadsActivation";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
import {availabilityTimestamp} from "../../work-orders/services/workOrderAvailabilityService";

export type CommitmentMetric="project_demand"|"fg_project_reservation"|"test_hold"|"work_order_reservation";
export type CommitmentScope="warehouse"|"raw_customs";
export interface CommitmentCursor {after_id:string;snapshot:string}
export interface CommitmentSource {
  source_id:string;source_type:CommitmentMetric;label:string;quantity:string;navigation_allowed:true;
  required_quantity:string|null;held_quantity:string|null;uncovered_quantity:string|null;
}
export interface CommitmentBreakdown {
  schema:1;product_id:string;warehouse_id:string;scope:CommitmentScope;scope_warehouse_ids:string[];metric:CommitmentMetric;as_of:string;
  metric_total:string;visible_total:string;restricted_remainder:string;restricted_label:"Restricted sources"|null;
  visible_before_quantity:string;page_subtotal:string;visible_after_quantity:string;limit:number;has_more:boolean;next_cursor:CommitmentCursor|null;items:CommitmentSource[];
}
export interface BreakdownRequest {productId:string;warehouseId:string;metric:CommitmentMetric;scope:CommitmentScope;limit?:number;cursor?:CommitmentCursor|null}
export type BreakdownResult={ok:true;value:CommitmentBreakdown}|{ok:false;error:{code:"access_denied"|"unavailable"|"stale_cursor";message:string}};
export const inventoryCommitmentBreakdownPrefix=(actor:string|undefined,profile:string|undefined)=>
  ["inventory-commitment-breakdown",new URL(frontendEnv.supabaseUrl).origin,actor,profile] as const;
const failure=(denied=false):BreakdownResult=>({ok:false,error:{code:denied?"access_denied":"unavailable",message:"Commitment sources unavailable"}});
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
const exact=(v:Record<string,unknown>,keys:string)=>Object.keys(v).sort().join()===keys.split(",").sort().join();
const decimal=(v:unknown):v is string=>typeof v==="string"&&/^(0|[1-9][0-9]{0,99})$/.test(v);
const cursor=(v:unknown):v is CommitmentCursor=>record(v)&&exact(v,"after_id,snapshot")&&testUuid(v.after_id)&&typeof v.snapshot==="string"&&/^[0-9a-f]{32}$/.test(v.snapshot);
const raw="10000000-0000-4000-8000-000000000001",fg="10000000-0000-4000-8000-000000000002",customs="10000000-0000-4000-8000-000000000003";
function valid(r:BreakdownRequest){return testUuid(r.productId)&&INVENTORY_WAREHOUSES.some(w=>w.id===r.warehouseId)&&["project_demand","fg_project_reservation","test_hold","work_order_reservation"].includes(r.metric)&&["warehouse","raw_customs"].includes(r.scope)&&
  (r.scope!=="raw_customs"||r.warehouseId===raw)&&(r.metric!=="project_demand"||r.scope==="raw_customs")&&(r.metric!=="fg_project_reservation"||r.warehouseId===fg&&r.scope==="warehouse")&&
  Number.isSafeInteger(r.limit??50)&&(r.limit??50)>=1&&(r.limit??50)<=100&&(r.cursor==null||cursor(r.cursor));}
export function parseInventoryCommitmentBreakdown(data:unknown,request:BreakdownRequest):BreakdownResult{
  const r=request,scopeIds=r.scope==="raw_customs"?[raw,customs]:[r.warehouseId];
  if(!valid(r)||!record(data)||!exact(data,"schema,product_id,warehouse_id,scope,scope_warehouse_ids,metric,as_of,metric_total,visible_total,restricted_remainder,restricted_label,visible_before_quantity,page_subtotal,visible_after_quantity,limit,has_more,next_cursor,items")||data.schema!==1||data.product_id!==r.productId||data.warehouse_id!==r.warehouseId||data.scope!==r.scope||data.metric!==r.metric||JSON.stringify(data.scope_warehouse_ids)!==JSON.stringify(scopeIds)||availabilityTimestamp(data.as_of)===null||data.limit!==(r.limit??50)||typeof data.has_more!=="boolean"||!Array.isArray(data.items)||data.items.length>(r.limit??50))return failure();
  for(const key of ["metric_total","visible_total","restricted_remainder","visible_before_quantity","page_subtotal","visible_after_quantity"])if(!decimal(data[key]))return failure();
  const total=BigInt(data.metric_total as string),visible=BigInt(data.visible_total as string),restricted=BigInt(data.restricted_remainder as string),before=BigInt(data.visible_before_quantity as string),page=BigInt(data.page_subtotal as string),after=BigInt(data.visible_after_quantity as string);
  if(total!==visible+restricted||visible!==before+page+after||data.restricted_label!==(restricted>0n?"Restricted sources":null)||data.has_more!==(after>0n)||!r.cursor&&before!==0n||data.has_more&&(!cursor(data.next_cursor)||data.items.length!==(r.limit??50))||!data.has_more&&data.next_cursor!==null)return failure();
  let sum=0n,last=r.cursor?.after_id??"";
  for(const item of data.items){
    if(!record(item)||!exact(item,"source_id,source_type,label,quantity,navigation_allowed,required_quantity,held_quantity,uncovered_quantity")||!testUuid(item.source_id)||item.source_id<=last||item.source_type!==r.metric||typeof item.label!=="string"||!item.label.trim()||item.navigation_allowed!==true||!decimal(item.quantity)||BigInt(item.quantity)<=0n)return failure();
    const context=[item.required_quantity,item.held_quantity,item.uncovered_quantity];
    if(!context.every(v=>v===null)&&(!context.every(decimal)||r.metric!=="work_order_reservation"||BigInt(item.required_quantity as string)!==BigInt(item.held_quantity as string)+BigInt(item.uncovered_quantity as string)||BigInt(item.held_quantity as string)<BigInt(item.quantity)))return failure();
    sum+=BigInt(item.quantity);last=item.source_id;
  }
  if(sum!==page||data.has_more&&(data.next_cursor as CommitmentCursor).after_id!==last)return failure();
  return{ok:true,value:data as unknown as CommitmentBreakdown};
}
// Not mounted by any UI. Gate checked before dispatch, including explicit retries.
export async function getInventoryCommitmentBreakdown(request:BreakdownRequest,token:string,signal?:AbortSignal):Promise<BreakdownResult>{
  if(!isWorkOrderCommitmentReadsEnabled()||!token||signal?.aborted)return failure(true);
  if(!valid(request))return failure();
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15000);signal?.addEventListener("abort",abort,{once:true});
  try{const {data,error}=await supabase.rpc("get_inventory_commitment_breakdown",{p_product_id:request.productId,p_warehouse_id:request.warehouseId,p_metric:request.metric,p_scope:request.scope,p_limit:request.limit??50,p_cursor:request.cursor??null}).setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);
    return controller.signal.aborted?failure():error?.code==="ICB01"?{ok:false,error:{code:"stale_cursor",message:"Commitment sources changed. Restart pagination."}}:error?failure(error.code==="42501"):parseInventoryCommitmentBreakdown(data,request);
  }catch{return failure();}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
