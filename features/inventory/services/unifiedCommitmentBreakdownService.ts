import {supabase} from "../../../lib/supabase/client";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
import {parseUnifiedCommitted,type UnifiedCommitted} from "./unifiedCommittedService";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
import type {BreakdownRequest,CommitmentBreakdown,CommitmentSource} from "./inventoryCommitmentBreakdownService";

export interface UnifiedCursor {after_key:string;snapshot:string}
export interface UnifiedBreakdownRequest {productId:string;warehouseId:string;scope:"warehouse"|"raw_customs";metric:"unified_committed";limit?:number;cursor?:UnifiedCursor|null}
export type DialogRequest=Omit<BreakdownRequest,"cursor">|Omit<UnifiedBreakdownRequest,"cursor">;
export interface DialogSource extends Omit<CommitmentSource,"source_type"|"navigation_allowed"> {
  source_type:CommitmentSource["source_type"]|"work_order_held";
  key?:string;navigation_allowed:boolean;
}
export interface DialogPage extends Omit<CommitmentBreakdown,"metric_total"|"items"|"next_cursor"|"metric"> {
  metric:DialogRequest["metric"];metric_total:string|null;items:DialogSource[];next_cursor:CommitmentBreakdown["next_cursor"]|UnifiedCursor;
  observation?:UnifiedCommitted;
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string)=>Object.keys(v).sort().join()===keys.split(",").sort().join();
const decimal=(v:unknown):v is string=>typeof v==="string"&&/^(0|[1-9][0-9]{0,127})$/.test(v);
const key=(v:unknown):v is string=>typeof v==="string"&&/^(project_demand|work_order_held):[0-9a-f-]{36}$/.test(v)&&testUuid(v.split(":")[1]);
export const unifiedCursor=(v:unknown):v is UnifiedCursor=>record(v)&&exact(v,"after_key,snapshot")&&key(v.after_key)&&typeof v.snapshot==="string"&&/^[a-f0-9]{32}$/.test(v.snapshot);
export type DialogResult={ok:true;value:DialogPage}|{ok:false;error:{code:"unavailable"|"access_denied"|"stale_cursor";message:string}};
type Result=DialogResult;
const fail=(code:"unavailable"|"access_denied"|"stale_cursor"="unavailable"):Result=>({ok:false,error:{code,message:"Unified commitment sources unavailable"}});
export function parseUnifiedBreakdown(data:unknown,r:UnifiedBreakdownRequest):Result {
  const limit=r.limit??25;
  if(!record(data)||!exact(data,"schema,observation,source_subtotal,visible_subtotal,restricted_subtotal,restricted_label,limit,before_subtotal,page_subtotal,after_subtotal,items,has_more,next_cursor")||data.schema!==2||data.limit!==limit||!Number.isInteger(limit)||limit<1||limit>100||!Array.isArray(data.items)||data.items.length>limit||typeof data.has_more!=="boolean"||r.cursor!=null&&!unifiedCursor(r.cursor))return fail();
  const observation=parseUnifiedCommitted(data.observation,r.productId,r.warehouseId);if(!observation.ok||observation.value.scope!==r.scope)return fail();
  for(const field of ["source_subtotal","visible_subtotal","restricted_subtotal","before_subtotal","page_subtotal","after_subtotal"])if(!decimal(data[field]))return fail();
  const n=(k:string)=>BigInt(data[k] as string),o=observation.value;
  if(n("source_subtotal")!==BigInt(o.committed_quantity)||n("source_subtotal")!==n("visible_subtotal")+n("restricted_subtotal")||n("visible_subtotal")!==n("before_subtotal")+n("page_subtotal")+n("after_subtotal")||!r.cursor&&n("before_subtotal")!==0n||data.restricted_label!==(n("restricted_subtotal")>0n?"Restricted sources":null)||data.has_more!==(n("after_subtotal")>0n))return fail();
  let last=r.cursor?.after_key??"",sum=0n;
  const items:DialogSource[]=[];
  for(const row of data.items){
    if(!record(row)||!exact(row,"key,source_type,source_id,label,quantity,navigation_allowed,target_type")||!key(row.key)||row.key!==`${row.source_type}:${row.source_id}`||row.key<=last||typeof row.label!=="string"||!row.label.trim()||row.navigation_allowed!==true||!decimal(row.quantity)||row.target_type!==(row.source_type==="project_demand"?"project":"work_order"))return fail();
    const q=BigInt(row.quantity);if(q<=0n)return fail();
    if(r.scope!=="raw_customs"&&row.source_type!=="work_order_held")return fail();
    sum+=q;last=row.key;
    items.push({key:row.key,source_id:row.source_id as string,source_type:row.source_type as DialogSource["source_type"],label:row.label,quantity:row.quantity,navigation_allowed:true,required_quantity:null,held_quantity:null,uncovered_quantity:null});
  }
  if(sum!==n("page_subtotal")||data.has_more&&(!unifiedCursor(data.next_cursor)||data.next_cursor.after_key!==last||items.length!==limit)||!data.has_more&&(data.next_cursor!==null||n("after_subtotal")!==0n)||data.has_more&&items.length===0)return fail();
  if(r.cursor&&data.has_more&&(data.next_cursor as UnifiedCursor).snapshot!==r.cursor.snapshot)return fail();
  return{ok:true,value:{schema:1,product_id:r.productId,warehouse_id:r.warehouseId,scope:r.scope,scope_warehouse_ids:r.scope==="raw_customs"?[INVENTORY_WAREHOUSES[0]!.id,INVENTORY_WAREHOUSES[2]!.id]:[r.warehouseId],metric:"unified_committed",as_of:o.as_of,metric_total:o.committed_quantity,observation:o,
    visible_total:data.visible_subtotal as string,restricted_remainder:data.restricted_subtotal as string,restricted_label:data.restricted_label as "Restricted sources"|null,
    visible_before_quantity:data.before_subtotal as string,page_subtotal:data.page_subtotal as string,visible_after_quantity:data.after_subtotal as string,limit,has_more:data.has_more,next_cursor:data.next_cursor as UnifiedCursor|null,items}};
}
export async function getUnifiedBreakdown(r:UnifiedBreakdownRequest,token:string,signal?:AbortSignal):Promise<Result>{
  if(!isUnifiedCommittedEnabled()||!token||signal?.aborted)return fail("access_denied");
  if(!testUuid(r.productId)||!INVENTORY_WAREHOUSES.some(w=>w.id===r.warehouseId)||r.metric!=="unified_committed"||r.scope!==(r.warehouseId===INVENTORY_WAREHOUSES[0]!.id?"raw_customs":"warehouse")||!Number.isInteger(r.limit??25)||(r.limit??25)<1||(r.limit??25)>100||r.cursor!=null&&!unifiedCursor(r.cursor))return fail();
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15000);signal?.addEventListener("abort",abort,{once:true});
  try{const {data,error}=await supabase.rpc("get_inventory_unified_commitment_breakdown",{p_product_id:r.productId,p_warehouse_id:r.warehouseId,p_limit:r.limit??25,p_cursor:r.cursor??null}).setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);
    return controller.signal.aborted?fail():error?fail(error.code==="ICB01"?"stale_cursor":error.code==="42501"?"access_denied":"unavailable"):parseUnifiedBreakdown(data,r);
  }catch{return fail();}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
