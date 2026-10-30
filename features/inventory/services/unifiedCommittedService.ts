import {supabase} from "../../../lib/supabase/client";
import {frontendEnv} from "../../../lib/config/env";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
import {availabilityTimestamp} from "../../work-orders/services/workOrderAvailabilityService";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
export interface UnifiedCommitted {
  schema:2;metric_definition:"project_demand_plus_work_order_held";product_id:string;warehouse_id:string;scope:"warehouse"|"raw_customs";as_of:string;
  project_demand:string;work_order_held:string;committed_quantity:string;
}
export type UnifiedResult<T>={ok:true;value:T}|{ok:false;error:{code:"access_denied"|"unavailable"|"stale_cursor"|"uncertain"|"rejected";message:string}};
const fail=<T>(code:"access_denied"|"unavailable"|"stale_cursor"|"uncertain"|"rejected"="unavailable"):UnifiedResult<T>=>({ok:false,error:{code,message:code==="uncertain"?"Result uncertain. Retry only the original request UUID and payload.":"Unified commitments unavailable"}});
const record=(x:unknown):x is Record<string,unknown>=>Boolean(x&&typeof x==="object"&&!Array.isArray(x));
const decimal=(x:unknown):x is string=>typeof x==="string"&&x.length<=128&&/^(0|[1-9][0-9]*)$/.test(x);
const exact=(x:Record<string,unknown>,fields:string)=>Object.keys(x).sort().join()===fields.split(",").sort().join();
export const unifiedCommittedPrefix=(actor:string|undefined,profile:string|undefined)=>["unified-committed",new URL(frontendEnv.supabaseUrl).origin,actor,profile] as const;
export function parseUnifiedCommitted(data:unknown,productId:string,warehouseId:string):UnifiedResult<UnifiedCommitted>{
  if(!record(data)||!exact(data,"schema,metric_definition,product_id,warehouse_id,scope,as_of,project_demand,work_order_held,committed_quantity")||data.schema!==2||data.metric_definition!=="project_demand_plus_work_order_held"||data.product_id!==productId||data.warehouse_id!==warehouseId||!testUuid(productId)||!INVENTORY_WAREHOUSES.some(w=>w.id===warehouseId)||availabilityTimestamp(data.as_of)===null)return fail();
  const raw=warehouseId===INVENTORY_WAREHOUSES[0]!.id;
  if(data.scope!==(raw?"raw_customs":"warehouse"))return fail();
  for(const field of ["project_demand","work_order_held","committed_quantity"])if(!decimal(data[field]))return fail();
  if(!raw&&data.project_demand!=="0"||BigInt(data.committed_quantity as string)!==BigInt(data.project_demand as string)+BigInt(data.work_order_held as string))return fail();
  return{ok:true,value:data as unknown as UnifiedCommitted};
}
async function read<T>(rpc:string,args:Record<string,unknown>,token:string,parse:(x:unknown)=>UnifiedResult<T>,signal?:AbortSignal):Promise<UnifiedResult<T>>{
  if(!isUnifiedCommittedEnabled()||!token||signal?.aborted)return fail("access_denied");
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15000);signal?.addEventListener("abort",abort,{once:true});
  try{const {data,error}=await supabase.rpc(rpc,args).setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);return error?fail(error.code==="42501"?"access_denied":error.code==="ICB01"?"stale_cursor":"unavailable"):controller.signal.aborted?fail():parse(data);}
  catch{return fail();}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
export function getUnifiedCommitted(productId:string,warehouseId:string,token:string,signal?:AbortSignal){
  if(!testUuid(productId)||!INVENTORY_WAREHOUSES.some(w=>w.id===warehouseId))return Promise.resolve(fail<UnifiedCommitted>());
  return read("get_inventory_unified_committed",{p_product_id:productId,p_warehouse_id:warehouseId},token,d=>parseUnifiedCommitted(d,productId,warehouseId),signal);
}
export interface AttributionRequest {
  requestId:string;kind:"coverage"|"independent";stateId:string;materialVersion:string;quantity:string;
  supersedesRequestId?:string|null;requirementId?:string|null;requirementUpdatedAt?:string|null;warehouseId?:string|null;
}
export interface AttributionReceipt {schema:1;request_id:string;kind:"coverage"|"independent";state_id:string}
export async function setMaterialAttribution(input:AttributionRequest,token:string):Promise<UnifiedResult<AttributionReceipt>>{
  if(!isUnifiedCommittedEnabled()||!token)return fail("access_denied");
  if(!testUuid(input.requestId)||!testUuid(input.stateId)||!decimal(input.materialVersion)||input.materialVersion==="0"||!decimal(input.quantity)||BigInt(input.quantity)>9223372036854775807n||BigInt(input.materialVersion)>9223372036854775807n||input.supersedesRequestId!=null&&!testUuid(input.supersedesRequestId)||
    input.kind==="coverage"&&(!testUuid(input.requirementId)||availabilityTimestamp(input.requirementUpdatedAt)===null||!INVENTORY_WAREHOUSES.some(w=>w.id===input.warehouseId))||
    input.kind==="independent"&&(input.requirementId!=null||input.requirementUpdatedAt!=null||input.warehouseId!=null))return fail("rejected");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const {data,error}=await supabase.rpc("set_work_order_material_attribution",{p_request_id:input.requestId,p_kind:input.kind,p_state_id:input.stateId,p_material_version:input.materialVersion,p_quantity:input.quantity,
    p_supersedes_request_id:input.supersedesRequestId??null,p_requirement_id:input.requirementId??null,p_requirement_updated_at:input.requirementUpdatedAt??null,p_warehouse_id:input.warehouseId??null})
    .setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);
    if(error)return fail(["42501","22023","23514","WRA01","WRA02","WRA03","WRC10","WRC11","WRC12","WRC13"].includes(error.code)?"rejected":"uncertain");
    if(controller.signal.aborted||!record(data)||!exact(data,"schema,request_id,kind,state_id")||data.schema!==1||data.request_id!==input.requestId||data.kind!==input.kind||data.state_id!==input.stateId)return fail("uncertain");
    return{ok:true,value:data as unknown as AttributionReceipt};
  }catch{return fail("uncertain");}finally{clearTimeout(timer);}
}
