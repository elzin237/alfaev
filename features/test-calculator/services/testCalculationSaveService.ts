import { supabase } from "../../../lib/supabase/client";
import { validTestQuantity } from "../testCalculationDraft";

export interface TestSaveRequest { requestId: string; name: string; deadlineDate: string; items: { product_id: string; quantity: string }[] }
export interface TestSavedItem { productId: string; name: string; serialNumber: string; productKind: string; required: string; held: string; missing: string; warehouses: { warehouseId: string; quantity: string }[] }
export interface TestSaveReceipt { calculationId: string; requestId: string; name: string; deadlineDate: string; expiresAt: string; createdAt: string; items: TestSavedItem[] }
export type TestSaveResult = { ok: true; value: TestSaveReceipt } | { ok: false; error: { code: string; uncertain: boolean; message: string } };
export const testUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const exact = (v: unknown, fields: string): v is Record<string,unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === fields.split(",").sort().join(","));
const time = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const uint = (v: unknown): v is string => typeof v === "string" && /^(?:0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
export function validTestSaveRequest(v: unknown): v is TestSaveRequest {
  if (!exact(v,"requestId,name,deadlineDate,items") || !testUuid(v.requestId) || typeof v.name !== "string" || !v.name || v.name.trim() !== v.name ||
    typeof v.deadlineDate !== "string" || !/^\d{4}-\d\d-\d\d$/.test(v.deadlineDate) || v.deadlineDate < "0001-01-01" ||
    !Number.isFinite(Date.parse(`${v.deadlineDate}T12:00:00Z`)) || new Date(`${v.deadlineDate}T12:00:00Z`).toISOString().slice(0,10) !== v.deadlineDate ||
    !Array.isArray(v.items) || v.items.length < 1 || v.items.length > 100) return false;
  return v.items.every(i => exact(i,"product_id,quantity") && testUuid(i.product_id) && typeof i.quantity === "string" && validTestQuantity(i.quantity)) &&
    new Set(v.items.map(i=>i.product_id)).size === v.items.length;
}
export function parseTestSaveReceipt(data: unknown, request: TestSaveRequest): TestSaveReceipt | null {
  if (!exact(data,"calculation_id,request_id,name,deadline_date,deadline_timezone,expires_at,created_at,items") || !testUuid(data.calculation_id) ||
    data.request_id !== request.requestId || data.name !== request.name || data.deadline_date !== request.deadlineDate || data.deadline_timezone !== "Europe/Sarajevo" ||
    !time(data.expires_at) || !time(data.created_at) || Date.parse(data.expires_at) <= Date.parse(data.created_at) || !Array.isArray(data.items) || data.items.length !== request.items.length) return null;
  const quantities=new Map(request.items.map(i=>[i.product_id,i.quantity])),items:TestSavedItem[]=[];
  for (const i of data.items) {
    if (!exact(i,"product_id,name,serial_number,product_kind,required_quantity,held_quantity,uncovered_quantity,warehouses") || !testUuid(i.product_id) ||
      !quantities.has(i.product_id) || i.required_quantity !== quantities.get(i.product_id) || typeof i.name !== "string" || !i.name.trim() ||
      typeof i.serial_number !== "string" || !/^(?:[0-9]{3}|[0-9]{7})$/.test(i.serial_number) || !["component","pcb_finished_good"].includes(i.product_kind as string) ||
      !uint(i.required_quantity) || !uint(i.held_quantity) || !uint(i.uncovered_quantity) || BigInt(i.required_quantity) !== BigInt(i.held_quantity)+BigInt(i.uncovered_quantity) || !Array.isArray(i.warehouses)) return null;
    const warehouses:TestSavedItem["warehouses"]=[],ids=new Set<string>();
    for (const w of i.warehouses) {
      if (!exact(w,"warehouse_id,quantity") || !testUuid(w.warehouse_id) || !uint(w.quantity) || ids.has(w.warehouse_id) ||
        !["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002","10000000-0000-4000-8000-000000000003"].includes(w.warehouse_id) ||
        (i.product_kind === "pcb_finished_good" && w.warehouse_id !== "10000000-0000-4000-8000-000000000002")) return null;
      ids.add(w.warehouse_id);warehouses.push({ warehouseId:w.warehouse_id,quantity:w.quantity });
    }
    if (warehouses.length !== (i.product_kind === "component" ? 3 : 1) || warehouses.reduce((n,w)=>n+BigInt(w.quantity),0n) !== BigInt(i.held_quantity)) return null;
    quantities.delete(i.product_id);items.push({ productId:i.product_id,name:i.name,serialNumber:i.serial_number,productKind:i.product_kind as string,required:i.required_quantity,held:i.held_quantity,missing:i.uncovered_quantity,warehouses });
  }
  return quantities.size ? null : { calculationId:data.calculation_id,requestId:request.requestId,name:request.name,deadlineDate:request.deadlineDate,expiresAt:data.expires_at,createdAt:data.created_at,items };
}
const uncertain = (): TestSaveResult => ({ ok:false,error:{ code:"outcome_uncertain",uncertain:true,message:"Save outcome is uncertain. Recover only the original request; do not create a replacement." } });
export async function saveTestCalculation(request: TestSaveRequest, accessToken: string): Promise<TestSaveResult> {
  if (!validTestSaveRequest(request) || !accessToken) return { ok:false,error:{ code:"invalid_request",uncertain:false,message:"The original Save request could not be verified." } };
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
  try {
    const { data,error }=await supabase.rpc("save_test_calculation",{ p_request_id:request.requestId,p_name:request.name,p_items:request.items,p_deadline_date:request.deadlineDate })
      .setHeader("Authorization",`Bearer ${accessToken}`).abortSignal(controller.signal);
    if (error) {
      if (["42501","TCS01","TCS02","22023","PGRST202","42883"].includes(error.code)) return { ok:false,error:{ code:error.code,uncertain:false,
        message:error.code === "42501" ? "Test Save access was denied. The original request is retained for authorized reconciliation." : "Test Save was rejected. Keep the original request for reconciliation; do not replace it." } };
      return uncertain();
    }
    const receipt=parseTestSaveReceipt(data,request);return receipt ? { ok:true,value:receipt } : uncertain();
  } catch { return uncertain(); } finally { clearTimeout(timer); }
}

// A new authorized read verifies saved history, never current stock from a replay receipt.
export async function reconcileTestCalculation(receipt: TestSaveReceipt, accessToken: string): Promise<boolean> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
  try {
    const { data:d,error }=await supabase.rpc("get_test_calculation",{ p_calculation_id:receipt.calculationId })
      .setHeader("Authorization",`Bearer ${accessToken}`).abortSignal(controller.signal);
    if(error || !exact(d,"calculation_id,name,creator_full_name,created_at,deadline_date,deadline_timezone,expires_at,status,as_of,items") ||
      d.calculation_id!==receipt.calculationId || d.name!==receipt.name || d.deadline_date!==receipt.deadlineDate || d.deadline_timezone!=="Europe/Sarajevo" ||
      !time(d.as_of) || !time(d.expires_at) || !time(d.created_at) || Date.parse(d.expires_at)!==Date.parse(receipt.expiresAt) || Date.parse(d.created_at)!==Date.parse(receipt.createdAt) ||
      typeof d.creator_full_name!=="string" || !["active","expired"].includes(d.status as string) ||
      d.status!==(Date.parse(d.expires_at)>Date.parse(d.as_of)?"active":"expired") || !Array.isArray(d.items) || d.items.length!==receipt.items.length) return false;
    const ids=new Set<string>();
    for(const i of d.items){
      if(!exact(i,"item_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,missing_quantity,holds") || !testUuid(i.item_id) || typeof i.product_id!=="string" || ids.has(i.product_id)) return false;
      ids.add(i.product_id);const saved=receipt.items.find(r=>r.productId===i.product_id);
      if(!saved || i.product_name_snapshot!==saved.name || i.serial_number_snapshot!==saved.serialNumber || i.product_kind_snapshot!==saved.productKind || i.required_quantity!==saved.required || i.held_quantity!==saved.held || i.missing_quantity!==saved.missing || !Array.isArray(i.holds))return false;
      const expected=saved.warehouses.filter(w=>w.quantity!=="0").map(w=>`${w.warehouseId}:${w.quantity}`).sort();
      const actual:string[]=[];
      for(const h of i.holds){if(!exact(h,"warehouse_id,warehouse_code,quantity") || typeof h.warehouse_id!=="string" || !uint(h.quantity) ||
        h.warehouse_code!==({"10000000-0000-4000-8000-000000000001":"raw_materials","10000000-0000-4000-8000-000000000002":"finished_goods","10000000-0000-4000-8000-000000000003":"customs"} as Record<string,string>)[h.warehouse_id])return false;actual.push(`${h.warehouse_id}:${h.quantity}`);}
      if(JSON.stringify(actual.sort())!==JSON.stringify(expected))return false;
    }return true;
  }catch{return false;}finally{clearTimeout(timer);}
}
