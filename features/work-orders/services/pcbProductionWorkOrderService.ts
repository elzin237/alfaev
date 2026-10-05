import { supabase } from "../../../lib/supabase/client";
import { isWorkOrderId } from "./workOrderService";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positiveBigintPattern = /^[1-9][0-9]*$/;
const nonnegativeBigintPattern = /^(0|[1-9][0-9]*)$/;
const maxBigint = 9_223_372_036_854_775_807n;

export interface PcbProductionWorkOrderContext {
  workOrderId: string;
  pcbCardId: string;
  pcbCardName: string;
  bomVersionId: string;
  bomVersionNumber: string;
  plannedQuantity: string;
  outputProductId: string;
  outputSerialNumber: string;
  outputProductName: string;
  actualGoodQuantity: string | null;
}

export type PcbProductionWorkOrderContextResult =
  | { ok: true; value: PcbProductionWorkOrderContext | null }
  | { ok: false; error: { code: "access_denied" | "invalid_response"; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBigintText(value: unknown, allowZero: boolean): value is string {
  if (typeof value !== "string" || !(allowZero ? nonnegativeBigintPattern : positiveBigintPattern).test(value)) {
    return false;
  }
  return BigInt(value) <= maxBigint;
}

function parseContext(value: unknown): PcbProductionWorkOrderContext | null {
  if (!isRecord(value) || Object.keys(value).length !== 10 ||
    !isWorkOrderId(value.work_order_id) ||
    typeof value.pcb_card_id !== "string" || !uuidPattern.test(value.pcb_card_id) ||
    typeof value.pcb_card_name !== "string" || !value.pcb_card_name.trim() ||
    value.pcb_card_name.trim() !== value.pcb_card_name ||
    typeof value.bom_version_id !== "string" || !uuidPattern.test(value.bom_version_id) ||
    !isBigintText(value.bom_version_number, false) ||
    !isBigintText(value.planned_quantity, false) ||
    typeof value.output_product_id !== "string" || !uuidPattern.test(value.output_product_id) ||
    typeof value.output_serial_number !== "string" || !/^[0-9]{7}$/.test(value.output_serial_number) ||
    typeof value.output_product_name !== "string" || !value.output_product_name.trim() ||
    value.output_product_name.trim() !== value.output_product_name ||
    !(value.actual_good_quantity === null || isBigintText(value.actual_good_quantity, true))) {
    return null;
  }
  return {
    workOrderId: value.work_order_id,
    pcbCardId: value.pcb_card_id,
    pcbCardName: value.pcb_card_name,
    bomVersionId: value.bom_version_id,
    bomVersionNumber: value.bom_version_number,
    plannedQuantity: value.planned_quantity,
    outputProductId: value.output_product_id,
    outputSerialNumber: value.output_serial_number,
    outputProductName: value.output_product_name,
    actualGoodQuantity: value.actual_good_quantity,
  };
}

export function normalizeActualGoodQuantity(value: string, plannedQuantity: string): string | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (!isBigintText(normalized, true) || BigInt(normalized) > BigInt(plannedQuantity)) return null;
  return normalized;
}

export async function getPcbProductionWorkOrderContext(
  workOrderId: string,
): Promise<PcbProductionWorkOrderContextResult> {
  const { data, error } = await supabase.rpc("get_pcb_production_work_order_context", {
    p_work_order_id: workOrderId,
  });
  if (error?.code === "42501") return { ok: false, error: { code: "access_denied", message: "You cannot view this PCB production context." } };
  if (error || !Array.isArray(data) || data.length > 1) {
    return { ok: false, error: { code: "invalid_response", message: "PCB production context could not be loaded." } };
  }
  if (data.length === 0) return { ok: true, value: null };
  const context = parseContext(data[0]);
  return context
    ? { ok: true, value: context }
    : { ok: false, error: { code: "invalid_response", message: "PCB production context could not be loaded." } };
}
