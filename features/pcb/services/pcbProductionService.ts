import { supabase } from "../../../lib/supabase/client";
import { isPcbCardId } from "./pcbBomService";

export interface ProducePcbInput {
  pcbCardId: string;
  plannedQuantity: string;
  creationRequestId: string;
}

export type ProducePcbErrorCode =
  | "access_denied" | "insufficient_inventory" | "bom_unavailable"
  | "card_unavailable" | "project_unavailable" | "product_unavailable"
  | "not_found" | "invalid_production" | "inventory_unavailable"
  | "invalid_configuration" | "unknown_outcome";

export type ProducePcbResult =
  | { ok: true; value: { workOrderId: string; workOrderNumber: string } }
  | { ok: false; error: { code: ProducePcbErrorCode; message: string } };

const errorMessages: Record<ProducePcbErrorCode, string> = {
  access_denied: "Your session no longer allows PCB production.",
  insufficient_inventory: "The production Work Order could not be created because Inventory validation failed.",
  bom_unavailable: "The active PCB BOM changed or is no longer available. Review the refreshed precheck.",
  card_unavailable: "This finished-product definition is no longer available for production.",
  project_unavailable: "The selected Project is no longer available for production.",
  product_unavailable: "A required PCB Product is no longer available for production.",
  not_found: "The finished-product definition or a required record no longer exists.",
  invalid_production: "Planned quantity or the current PCB state is invalid or exceeds the supported range.",
  inventory_unavailable: "Inventory state is unavailable. The Work Order was not created.",
  invalid_configuration: "PCB configuration is invalid. The Work Order was not created.",
  unknown_outcome: "Work Order creation could not be confirmed. Retry this submission to safely check the same request.",
};

const sqlstateCodes: Record<string, ProducePcbErrorCode> = {
  "42501": "access_denied", IVB02: "insufficient_inventory", PCB06: "bom_unavailable",
  PCB07: "card_unavailable", PCB10: "project_unavailable", PCB04: "product_unavailable",
  PRD01: "product_unavailable", P0002: "not_found", "22023": "invalid_production",
  IVB01: "inventory_unavailable", PCB01: "invalid_configuration", PCB05: "invalid_configuration",
  PCB13: "invalid_production",
};

function failure(code: ProducePcbErrorCode): ProducePcbResult {
  return { ok: false, error: { code, message: errorMessages[code] } };
}

export async function producePcb(input: ProducePcbInput): Promise<ProducePcbResult> {
  if (!isPcbCardId(input.pcbCardId) ||
    !isPcbCardId(input.creationRequestId) ||
    !/^[0-9]+$/.test(input.plannedQuantity) ||
    BigInt(input.plannedQuantity) === 0n ||
    BigInt(input.plannedQuantity) > 9223372036854775807n) {
    return failure("invalid_production");
  }
  try {
    const { data, error } = await supabase.rpc("create_pcb_production_work_order", {
      p_pcb_card_id: input.pcbCardId,
      p_planned_quantity: input.plannedQuantity,
      p_project_id: null,
      p_creation_request_id: input.creationRequestId,
    });
    if (error) return failure(sqlstateCodes[error.code] ?? "unknown_outcome");
    if (!Array.isArray(data) || data.length !== 1) return failure("unknown_outcome");
    const row: unknown = data[0];
    if (typeof row !== "object" || row === null || Array.isArray(row)) return failure("unknown_outcome");
    const record = row as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.work_order_id !== "string" ||
      !isPcbCardId(record.work_order_id) ||
      typeof record.work_order_number !== "string" ||
      !/^RN-[0-9]{4}-[0-9]{4}$/.test(record.work_order_number)) return failure("unknown_outcome");
    return { ok: true, value: {
      workOrderId: record.work_order_id,
      workOrderNumber: record.work_order_number,
    } };
  } catch {
    return failure("unknown_outcome");
  }
}
