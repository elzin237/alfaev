import { supabase } from "../../../lib/supabase/client";
import { testUuid } from "./testCalculationSaveService";

export interface TestHistoryCursor { createdAt:string; id:string }
export interface TestHistoryHeader {
  calculationId:string; name:string; creatorFullName:string|null; createdAt:string; deadlineDate:string;
  deadlineTimezone:"Europe/Sarajevo"; expiresAt:string; status:"active"|"expired"; asOf:string;
}
export interface TestHistoryItem {
  itemId:string; productId:string; name:string; serialNumber:string; productKind:"component"|"pcb_finished_good";
  required:string; held:string; missing:string; holds:{warehouseId:string;warehouseCode:string;quantity:string}[];
}
export interface TestHistoryDetail extends TestHistoryHeader { items:TestHistoryItem[] }
export interface TestHistoryPage { rows:TestHistoryHeader[]; nextCursor:TestHistoryCursor|null }
export type TestHistoryResult<T>={ok:true;value:T}|{ok:false;error:{code:"access_denied"|"not_found"|"invalid_request"|"load_failed";message:string}};
const exact=(v:unknown,keys:string):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.split(",").sort().join());
const headerKeys="calculation_id,name,creator_full_name,created_at,deadline_date,deadline_timezone,expires_at,status,as_of";
const uint=(v:unknown):v is string=>typeof v==="string"&&/^(?:0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const date=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\d$/.test(v)&&v>="0001-01-01"&&Number.isFinite(Date.parse(`${v}T12:00:00Z`))&&new Date(`${v}T12:00:00Z`).toISOString().slice(0,10)===v;
// Preserve PostgreSQL microseconds: Date alone would collapse distinct keyset rows.
export function historyTimestampMicros(v:unknown):bigint|null {
  if(typeof v!=="string")return null;
  const parts=/^(\d{4}-\d\d-\d\d)T([0-2]\d):([0-5]\d):([0-5]\d)(?:\.([0-9]{1,6}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(v);
  if(!parts||!date(parts[1])||parts[2]!>"23")return null;
  const millis=Date.parse(`${parts[1]}T${parts[2]}:${parts[3]}:${parts[4]}${parts[6]}`);
  return Number.isFinite(millis)?BigInt(millis)*1000n+BigInt((parts[5]??"").padEnd(6,"0")):null;
}
function header(v:unknown):TestHistoryHeader|null {
  if(!exact(v,headerKeys)||!testUuid(v.calculation_id)||typeof v.name!=="string"||!v.name.trim()||
    !(v.creator_full_name===null||typeof v.creator_full_name==="string"&&Boolean(v.creator_full_name.trim()))||
    !date(v.deadline_date)||v.deadline_timezone!=="Europe/Sarajevo")return null;
  const created=historyTimestampMicros(v.created_at),expiry=historyTimestampMicros(v.expires_at),asOf=historyTimestampMicros(v.as_of);
  if(created===null||expiry===null||asOf===null||expiry<=created||v.status!==(expiry>asOf?"active":"expired"))return null;
  return {calculationId:v.calculation_id,name:v.name,creatorFullName:v.creator_full_name as string|null,createdAt:v.created_at as string,
    deadlineDate:v.deadline_date,deadlineTimezone:"Europe/Sarajevo",expiresAt:v.expires_at as string,status:v.status as "active"|"expired",asOf:v.as_of as string};
}
const failure=<T>(code:"access_denied"|"not_found"|"invalid_request"|"load_failed"):TestHistoryResult<T>=>({ok:false,error:{code,message:
  code==="access_denied"?"You do not have permission to read Test Calculation history.":code==="not_found"?"This saved Test Calculation could not be found.":"Saved Test Calculation history could not be verified. Try again."}});
async function read(rpc:"list_test_calculations"|"get_test_calculation",args:Record<string,unknown>,token:string,signal?:AbortSignal){
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15_000);
  signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  try{return await supabase.rpc(rpc,args).setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
const older=(a:TestHistoryCursor,b:TestHistoryCursor)=>{
  const x=historyTimestampMicros(a.createdAt)!,y=historyTimestampMicros(b.createdAt)!;
  return x<y||(x===y&&a.id<b.id);
};
export async function listTestCalculations(limit=20,cursor:TestHistoryCursor|null=null,token:string,signal?:AbortSignal):Promise<TestHistoryResult<TestHistoryPage>>{
  if(!token||!Number.isInteger(limit)||limit<1||limit>100||(cursor!==null&&(!exact(cursor,"createdAt,id")||!testUuid(cursor.id)||historyTimestampMicros(cursor.createdAt)===null)))return failure("invalid_request");
  try{const {data,error}=await read("list_test_calculations",{p_limit:limit,p_before_created_at:cursor?.createdAt??null,p_before_id:cursor?.id??null},token,signal);
    if(error)return failure(error.code==="42501"?"access_denied":"load_failed");
    if(!Array.isArray(data)||data.length>limit)return failure("load_failed");
    const rows:TestHistoryHeader[]=[],ids=new Set<string>();let previous=cursor;
    for(const value of data){const row=header(value);if(!row||ids.has(row.calculationId)||(rows[0]&&rows[0].asOf!==row.asOf))return failure("load_failed");
      const next={createdAt:row.createdAt,id:row.calculationId};if(previous&&!older(next,previous))return failure("load_failed");
      ids.add(row.calculationId);rows.push(row);previous=next;
    }
    return {ok:true,value:{rows,nextCursor:rows.length===limit?previous:null}};
  }catch{return failure("load_failed");}
}
export async function getTestCalculation(calculationId:string,token:string,signal?:AbortSignal):Promise<TestHistoryResult<TestHistoryDetail>>{
  if(!token||!testUuid(calculationId))return failure("invalid_request");
  try{const {data,error}=await read("get_test_calculation",{p_calculation_id:calculationId},token,signal);
    if(error)return failure(error.code==="42501"?"access_denied":error.code==="P0002"?"not_found":"load_failed");
    if(!exact(data,`${headerKeys},items`)||data.calculation_id!==calculationId||!Array.isArray(data.items)||data.items.length<1||data.items.length>100)return failure("load_failed");
    const {items:raw,...rawHeader}=data,base=header(rawHeader);if(!base)return failure("load_failed");
    const items:TestHistoryItem[]=[],products=new Set<string>(),itemIds=new Set<string>();
    for(const value of raw as unknown[]){
      if(!exact(value,"item_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,missing_quantity,holds")||
        !testUuid(value.item_id)||itemIds.has(value.item_id)||!testUuid(value.product_id)||products.has(value.product_id)||
        typeof value.product_name_snapshot!=="string"||!value.product_name_snapshot.trim()||typeof value.serial_number_snapshot!=="string"||!/^(?:[0-9]{3}|[0-9]{7})$/.test(value.serial_number_snapshot)||
        !["component","pcb_finished_good"].includes(value.product_kind_snapshot as string)||!uint(value.required_quantity)||value.required_quantity==="0"||!uint(value.held_quantity)||!uint(value.missing_quantity)||
        BigInt(value.required_quantity)!==BigInt(value.held_quantity)+BigInt(value.missing_quantity)||!Array.isArray(value.holds)||value.holds.length>3)return failure("load_failed");
      const holds:TestHistoryItem["holds"]=[],warehouses=new Set<string>();
      for(const h of value.holds){if(!exact(h,"warehouse_id,warehouse_code,quantity")||!testUuid(h.warehouse_id)||typeof h.warehouse_code!=="string"||warehouses.has(h.warehouse_id)||!uint(h.quantity)||
        h.warehouse_code!==({"10000000-0000-4000-8000-000000000001":"raw_materials","10000000-0000-4000-8000-000000000002":"finished_goods","10000000-0000-4000-8000-000000000003":"customs"} as Record<string,string>)[h.warehouse_id])return failure("load_failed");
        warehouses.add(h.warehouse_id);holds.push({warehouseId:h.warehouse_id,warehouseCode:h.warehouse_code as string,quantity:h.quantity});}
      if(holds.reduce((n,h)=>n+BigInt(h.quantity),0n)!==BigInt(value.held_quantity))return failure("load_failed");
      products.add(value.product_id);itemIds.add(value.item_id);items.push({itemId:value.item_id,productId:value.product_id,name:value.product_name_snapshot,serialNumber:value.serial_number_snapshot,productKind:value.product_kind_snapshot as TestHistoryItem["productKind"],required:value.required_quantity,held:value.held_quantity,missing:value.missing_quantity,holds});
    }
    return {ok:true,value:{...base,items}};
  }catch{return failure("load_failed");}
}
