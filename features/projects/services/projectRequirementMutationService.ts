import { supabase } from "../../../lib/supabase/client";
import { isProjectId } from "./projectService";

export interface RequirementRequest {
  requestId: string; operation: "create" | "update" | "remove"; projectId: string; groupId: string;
  componentId: string | null; productId: string | null; quantity: string | null;
  expectedProductId: string | null; expectedQuantity: string | null;
}
export interface RequirementReceipt {
  request_id: string; component_id: string; operation: RequirementRequest["operation"];
  affected_products: { product_id: string; reserved_quantity: string; outstanding_demand: string; uncovered_demand: string }[];
}
export type RequirementResult = { ok: true; value: RequirementReceipt } |
  { ok: false; error: { code: string; message: string; uncertain: boolean } };
export const positiveQuantity = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]*$/.test(v) &&
  v.length <= 19 && BigInt(v) <= 9223372036854775807n;
const fields = ["requestId","operation","projectId","groupId","componentId","productId","quantity","expectedProductId","expectedQuantity"];
export function validRequirementRequest(v: unknown): v is RequirementRequest {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string,unknown>;
  return Object.keys(r).length === fields.length && Object.keys(r).every(k=>fields.includes(k)) &&
    [r.requestId,r.projectId,r.groupId].every(x=>typeof x === "string" && isProjectId(x)) &&
    ["create","update","remove"].includes(String(r.operation)) &&
    (r.operation === "create" ? r.componentId === null && r.expectedProductId === null && r.expectedQuantity === null
      : typeof r.componentId === "string" && isProjectId(r.componentId) && typeof r.expectedProductId === "string" && isProjectId(r.expectedProductId) && positiveQuantity(r.expectedQuantity)) &&
    (r.operation === "remove" ? r.productId === null && r.quantity === null
      : typeof r.productId === "string" && isProjectId(r.productId) && positiveQuantity(r.quantity));
}
const messages: Record<string,string> = {
  FGA01: "Refresh this Project to use the atomic Finished Goods requirement editor.",
  FGA02: "The requirement changed. Refresh and review it before submitting a new decision.",
  FGR01: "The request UUID belongs to a different operation. Keep the original recovery request.",
  FGR03: "This Finished Product is unavailable. Archived outputs can only be reduced or removed.",
  PPL01: "Completed or Cancelled Projects cannot be changed.", PPL02: "This Product requirement already exists in this group.",
  PPL04: "The selected Product is unavailable.", P0002: "The Project or requirement was not found.",
  "22023": "Enter valid requirement details.", "22003": "The quantity exceeds the supported range.",
};
export async function mutateProjectRequirement(request: Readonly<RequirementRequest>, token?: string): Promise<RequirementResult> {
  if (!validRequirementRequest(request)) return { ok:false,error:{code:"22023",message:messages["22023"]!,uncertain:false} };
  const uncertain = (code="outcome_uncertain",message="The outcome is uncertain. Retry the saved original request, not a new operation."): RequirementResult =>
    ({ok:false,error:{code,message,uncertain:true}});
  try {
    const query = supabase.rpc("mutate_project_requirement", {
      p_request_id:request.requestId,p_operation:request.operation,p_project_id:request.projectId,p_project_product_id:request.groupId,
      p_component_id:request.componentId,p_product_id:request.productId,p_required_quantity:request.quantity,
      p_expected_product_id:request.expectedProductId,p_expected_quantity:request.expectedQuantity,
    });
    if (token) query.setHeader("Authorization",`Bearer ${token}`);
    const {data,error}=await query.abortSignal(AbortSignal.timeout(30_000));
    if(error) {
      if(error.code==="42501")return uncertain("42501","Current permissions do not allow this operation. The original request is retained until its outcome can be reconciled.");
      if(error.code==="FGR01")return uncertain(error.code,messages.FGR01);
      if(messages[error.code])return {ok:false,error:{code:error.code,message:messages[error.code]!,uncertain:false}};
      return uncertain();
    }
    if(!data || typeof data!=="object" || Array.isArray(data) ||
      Object.keys(data).sort().join()!==["request_id","component_id","operation","affected_products"].sort().join() ||
      data.request_id!==request.requestId || data.operation!==request.operation || !isProjectId(data.component_id) ||
      (request.componentId!==null && request.componentId!==data.component_id) || !Array.isArray(data.affected_products) ||
      data.affected_products.length>2)return uncertain();
    const seen=new Set<string>();
    for(const row of data.affected_products) {
      const integer=(v:unknown):v is string=>typeof v==="string"&&v.length<=128&&/^(0|[1-9][0-9]*)$/.test(v);
      if(!row || typeof row!=="object" || Object.keys(row).sort().join()!==["product_id","reserved_quantity","outstanding_demand","uncovered_demand"].sort().join() ||
        !isProjectId(row.product_id) || ![request.productId,request.expectedProductId].includes(row.product_id) || seen.has(row.product_id) || !integer(row.reserved_quantity) || !integer(row.outstanding_demand) || !integer(row.uncovered_demand) ||
        BigInt(row.reserved_quantity)>9223372036854775807n || BigInt(row.uncovered_demand)!==BigInt(row.outstanding_demand)-BigInt(row.reserved_quantity))return uncertain();
      seen.add(row.product_id);
    }
    return {ok:true,value:data as RequirementReceipt};
  }catch{return uncertain();}
}
