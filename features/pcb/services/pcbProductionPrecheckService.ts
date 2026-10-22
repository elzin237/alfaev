import { supabase } from "../../../lib/supabase/client";
import { isPcbCardId } from "./pcbBomService";

export interface PcbProductionInput {
  productId: string;
  name: string;
  serialNumber: string;
  isActive: boolean;
  quantityPerCard: string;
  availableQuantity: string;
}

export interface PcbProductionSource {
  cardId: string;
  cardName: string;
  outputProductId: string;
  outputSerialNumber: string;
  outputIsActive: boolean;
  versionId: string;
  versionNumber: string;
  inputs: PcbProductionInput[];
}

export type PcbProductionProjectStatus = "planned" | "in_progress" | "on_hold";
export interface PcbProductionProjectChoice {
  projectId: string;
  name: string;
  status: PcbProductionProjectStatus;
}

export type PcbPrecheckReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: "not_found" | "unavailable" | "read_failed"; message: string } };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serial = /^(?:[0-9]{3}|[0-9]{7})$/;
const maxBigint = 9223372036854775807n;
const failed = { ok: false as const, error: { code: "read_failed" as const,
  message: "PCB production precheck could not be loaded." } };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
function name(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}
function whole(value: unknown, positive: boolean): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) &&
    BigInt(value) <= maxBigint && (!positive || BigInt(value) > 0n);
}

export async function getPcbProductionPrecheck(cardId: string): Promise<PcbPrecheckReadResult<PcbProductionSource>> {
  if (!isPcbCardId(cardId)) return { ok: false, error: { code: "not_found", message: "Finished-product definition not found." } };
  const { data, error } = await supabase.rpc("get_pcb_production_precheck", { p_pcb_card_id: cardId });
  if (error?.code === "P0002") return { ok: false, error: { code: "not_found", message: "Finished-product definition not found." } };
  if (error?.code === "PCB06" || error?.code === "PCB07") {
    return { ok: false, error: { code: "unavailable", message: "This finished-product definition is not available for production." } };
  }
  if (error || !Array.isArray(data) || data.length === 0) return failed;

  let source: PcbProductionSource | null = null;
  const seen = new Set<string>();
  for (const row of data) {
    if (!record(row) || !id(row.card_id) || row.card_id !== cardId || !name(row.card_name) ||
      !id(row.output_product_id) || typeof row.output_serial_number !== "string" ||
      !serial.test(row.output_serial_number) || typeof row.output_product_is_active !== "boolean" ||
      !id(row.active_bom_version_id) || !whole(row.active_bom_version_number, true)) return failed;
    if (!source) {
      source = { cardId: row.card_id, cardName: row.card_name, outputProductId: row.output_product_id,
        outputSerialNumber: row.output_serial_number, outputIsActive: row.output_product_is_active,
        versionId: row.active_bom_version_id, versionNumber: row.active_bom_version_number, inputs: [] };
    } else if (source.cardName !== row.card_name || source.outputProductId !== row.output_product_id ||
      source.outputSerialNumber !== row.output_serial_number || source.outputIsActive !== row.output_product_is_active ||
      source.versionId !== row.active_bom_version_id || source.versionNumber !== row.active_bom_version_number) return failed;
    if (row.input_product_id === null) {
      if (row.input_product_name !== null || row.input_serial_number !== null ||
        row.input_product_is_active !== null || row.quantity_per_card !== null ||
        row.available_quantity !== null || data.length !== 1) return failed;
      continue;
    }
    if (!id(row.input_product_id) || !name(row.input_product_name) ||
      typeof row.input_serial_number !== "string" || !serial.test(row.input_serial_number) ||
      typeof row.input_product_is_active !== "boolean" || !whole(row.quantity_per_card, true) ||
      !whole(row.available_quantity, false) || row.input_product_id === source.outputProductId ||
      seen.has(row.input_product_id)) return failed;
    seen.add(row.input_product_id);
    source.inputs.push({ productId: row.input_product_id, name: row.input_product_name,
      serialNumber: row.input_serial_number, isActive: row.input_product_is_active,
      quantityPerCard: row.quantity_per_card, availableQuantity: row.available_quantity });
  }
  return source ? { ok: true, value: source } : failed;
}

export async function listPcbProductionProjectChoices(): Promise<PcbPrecheckReadResult<PcbProductionProjectChoice[]>> {
  const { data, error } = await supabase.rpc("list_pcb_production_project_choices");
  if (error || !Array.isArray(data)) return failed;
  const choices: PcbProductionProjectChoice[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!record(row) || !id(row.project_id) || !name(row.name) ||
      (row.status !== "planned" && row.status !== "in_progress" && row.status !== "on_hold") ||
      seen.has(row.project_id)) return failed;
    seen.add(row.project_id);
    choices.push({ projectId: row.project_id, name: row.name, status: row.status });
  }
  return { ok: true, value: choices };
}
