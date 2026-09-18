import { supabase } from "../../../lib/supabase/client";
import { isPcbCardId } from "./pcbBomService";

export interface ProducePcbInput {
  pcbCardId: string;
  quantityToProduce: string;
  projectId: string | null;
}

export type ProducePcbErrorCode =
  | "access_denied" | "insufficient_inventory" | "bom_unavailable"
  | "card_unavailable" | "project_unavailable" | "product_unavailable"
  | "not_found" | "invalid_production" | "inventory_unavailable"
  | "invalid_configuration" | "unknown_outcome";

export type ProducePcbResult =
  | { ok: true; value: { runId: string } }
  | { ok: false; error: { code: ProducePcbErrorCode; message: string } };

const errorMessages: Record<ProducePcbErrorCode, string> = {
  access_denied: "Your session no longer allows PCB production.",
  insufficient_inventory: "Production cannot be completed because Inventory is insufficient.",
  bom_unavailable: "The active PCB BOM changed or is no longer available. Review the refreshed precheck.",
  card_unavailable: "This PCB Card is no longer available for production.",
  project_unavailable: "The selected Project is no longer available for production.",
  product_unavailable: "A required PCB Product is no longer available for production.",
  not_found: "The PCB Card or a required record no longer exists.",
  invalid_production: "Production quantity or current state is invalid or exceeds the supported range.",
  inventory_unavailable: "Inventory state is unavailable. Production did not complete.",
  invalid_configuration: "PCB configuration is invalid. Production cannot be completed.",
  unknown_outcome: "Production status could not be confirmed. Review refreshed stock before trying again.",
};

const sqlstateCodes: Record<string, ProducePcbErrorCode> = {
  "42501": "access_denied", IVB02: "insufficient_inventory", PCB06: "bom_unavailable",
  PCB07: "card_unavailable", PCB10: "project_unavailable", PCB04: "product_unavailable",
  PRD01: "product_unavailable", P0002: "not_found", "22023": "invalid_production",
  IVB01: "inventory_unavailable", PCB01: "invalid_configuration", PCB05: "invalid_configuration",
};

function failure(code: ProducePcbErrorCode): ProducePcbResult {
  return { ok: false, error: { code, message: errorMessages[code] } };
}

export async function producePcb(input: ProducePcbInput): Promise<ProducePcbResult> {
  if (!isPcbCardId(input.pcbCardId) ||
    (input.projectId !== null && !isPcbCardId(input.projectId)) ||
    !/^[0-9]+$/.test(input.quantityToProduce) ||
    BigInt(input.quantityToProduce) === 0n ||
    BigInt(input.quantityToProduce) > 9223372036854775807n) {
    return failure("invalid_production");
  }
  try {
    const { data, error } = await supabase.rpc("produce_pcb", {
      p_pcb_card_id: input.pcbCardId,
      p_quantity_to_produce: input.quantityToProduce,
      p_project_id: input.projectId,
    });
    if (error) return failure(sqlstateCodes[error.code] ?? "unknown_outcome");
    if (typeof data !== "string" || !isPcbCardId(data)) return failure("unknown_outcome");
    return { ok: true, value: { runId: data } };
  } catch {
    return failure("unknown_outcome");
  }
}
