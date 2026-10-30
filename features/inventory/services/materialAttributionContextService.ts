import {supabase} from "../../../lib/supabase/client";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
import {availabilityTimestamp} from "../../work-orders/services/workOrderAvailabilityService";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
export interface AttributionAllocation {warehouse_id:string;held:string}
export interface RequirementAllocation {warehouse_id:string;request_id:string|null;quantity:string;max_quantity:string}
export interface AttributionRequirement {id:string;revision:string;project_name:string;group_name:string;quantity:string;outstanding:string|null;allocations:RequirementAllocation[]}
export interface AttributionContext {schema:1;work_order_id:string;product_id:string;state_id:string;material_version:string;draft_updated_at:string;as_of:string;
  required:string;held:string;uncovered:string;coverage:string;independent:string;unknown:string;independence_request_id:string|null;max_independent:string;
  allocations:AttributionAllocation[];requirements:AttributionRequirement[];has_more:boolean;next_after:string|null}
const object=(x:unknown):x is Record<string,unknown>=>Boolean(x&&typeof x==="object"&&!Array.isArray(x));
const exact=(x:Record<string,unknown>,keys:string)=>Object.keys(x).sort().join()===keys.split(",").sort().join();
const quantity=(x:unknown):x is string=>typeof x==="string"&&/^(0|[1-9][0-9]{0,18})$/.test(x)&&BigInt(x)<=9223372036854775807n;
const warehouse=(x:unknown)=>INVENTORY_WAREHOUSES.some(w=>w.id===x);
export function parseAttributionContext(x:unknown,wo:string,product:string):AttributionContext|null{
  if(!testUuid(wo)||!testUuid(product))return null;
  if(!object(x)||!exact(x,"schema,work_order_id,product_id,state_id,material_version,draft_updated_at,as_of,required,held,uncovered,coverage,independent,unknown,independence_request_id,max_independent,allocations,requirements,has_more,next_after")||x.schema!==1||x.work_order_id!==wo||x.product_id!==product||!testUuid(x.state_id)||!quantity(x.material_version)||x.material_version==="0"||availabilityTimestamp(x.draft_updated_at)===null||availabilityTimestamp(x.as_of)===null||x.independence_request_id!==null&&!testUuid(x.independence_request_id)||typeof x.has_more!=="boolean"||!Array.isArray(x.allocations)||x.allocations.length>3||!Array.isArray(x.requirements)||x.requirements.length>20)return null;
  for(const key of ["required","held","uncovered","coverage","independent","unknown","max_independent"])if(!quantity(x[key]))return null;
  const r=BigInt(x.required as string),h=BigInt(x.held as string),c=BigInt(x.coverage as string),i=BigInt(x.independent as string);
  if(r!==h+BigInt(x.uncovered as string)||r!==c+i+BigInt(x.unknown as string)||c>h||i>0n&&x.independence_request_id===null||BigInt(x.max_independent as string)!==r-c)return null;
  const warehouses=new Set<string>();let sum=0n;
  for(const a of x.allocations){if(!object(a)||!exact(a,"warehouse_id,held")||!warehouse(a.warehouse_id)||warehouses.has(a.warehouse_id as string)||!quantity(a.held)||a.held==="0")return null;warehouses.add(a.warehouse_id as string);sum+=BigInt(a.held);}
  if(sum!==h)return null;let previous="";
  for(const q of x.requirements){if(!object(q)||!exact(q,"id,revision,project_name,group_name,quantity,outstanding,allocations")||!testUuid(q.id)||q.id<=previous||availabilityTimestamp(q.revision)===null||typeof q.project_name!=="string"||!q.project_name.trim()||typeof q.group_name!=="string"||!quantity(q.quantity)||q.quantity==="0"||q.outstanding!==null&&q.outstanding!==q.quantity||!Array.isArray(q.allocations)||q.allocations.length!==x.allocations.length)return null;previous=q.id;
    const seen=new Set<string>();for(const a of q.allocations){if(!object(a)||!exact(a,"warehouse_id,request_id,quantity,max_quantity")||!warehouses.has(a.warehouse_id as string)||seen.has(a.warehouse_id as string)||a.request_id!==null&&!testUuid(a.request_id)||!quantity(a.quantity)||!quantity(a.max_quantity)||BigInt(a.quantity)>c||BigInt(a.quantity)>BigInt(a.max_quantity)||a.quantity!=="0"&&a.request_id===null||BigInt(a.max_quantity)>r||BigInt(a.max_quantity)>BigInt(q.quantity)||BigInt(a.max_quantity)>BigInt((x.allocations.find((v:unknown)=>object(v)&&v.warehouse_id===a.warehouse_id) as {held:string}).held)||q.outstanding===null&&a.max_quantity!=="0")return null;seen.add(a.warehouse_id as string);}
  }
  if(x.has_more?(x.requirements.length!==20||x.next_after!==previous):x.next_after!==null)return null;
  return x as unknown as AttributionContext;
}
export async function getAttributionContext(wo:string,product:string,token:string,after:string|null=null,signal?:AbortSignal){
  if(!isUnifiedCommittedEnabled()||!token||!testUuid(wo)||!testUuid(product)||after!==null&&!testUuid(after)||signal?.aborted)return null;
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15000);signal?.addEventListener("abort",abort,{once:true});
  try{const {data,error}=await supabase.rpc("get_work_order_attribution_context",{p_work_order_id:wo,p_product_id:product,p_limit:20,p_after:after}).setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);return error||controller.signal.aborted?null:parseAttributionContext(data,wo,product);}
  catch{return null;}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
