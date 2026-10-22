import { supabase } from "../../../lib/supabase/client";

export interface PcbCardListItem {
  id: string;
  name: string;
  isActive: boolean;
  outputProductId: string;
  serialNumber: string;
  currentStock: number;
}

export interface CreatedPcbCard {
  pcbCardId: string;
  productId: string;
  serialNumber: string;
}

type PcbErrorCode = "access_denied" | "invalid_name" | "invalid_serial" |
  "duplicate_name" | "duplicate_serial" | "pcb_list_failed" | "pcb_create_failed";
export type PcbResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: PcbErrorCode; message: string } };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const productSerialPattern = /^(?:[0-9]{3}|[0-9]{7})$/;
const calculatorSerialPattern = /^[0-9]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function mapListRow(value: unknown): PcbCardListItem | null {
  if (!isRecord(value) || !isUuid(value.pcb_card_id) ||
    !isUuid(value.output_product_id) ||
    typeof value.card_name !== "string" ||
    value.card_name.length === 0 || value.card_name !== value.card_name.trim() ||
    typeof value.is_active !== "boolean" ||
    typeof value.serial_number !== "string" ||
    !productSerialPattern.test(value.serial_number) ||
    typeof value.current_stock !== "number" ||
    !Number.isSafeInteger(value.current_stock) || value.current_stock < 0) {
    return null;
  }
  return {
    id: value.pcb_card_id,
    name: value.card_name,
    isActive: value.is_active,
    outputProductId: value.output_product_id,
    serialNumber: value.serial_number,
    currentStock: value.current_stock,
  };
}

export async function listPcbCards(): Promise<PcbResult<PcbCardListItem[]>> {
  const { data, error } = await supabase.rpc("list_pcb_cards");
  if (error || !Array.isArray(data)) {
    return { ok: false, error: { code: "pcb_list_failed", message: "Finished Product Calculator could not be loaded." } };
  }
  const cards: PcbCardListItem[] = [];
  for (const row of data) {
    const card = mapListRow(row);
    if (!card) {
      return { ok: false, error: { code: "pcb_list_failed", message: "Finished Product Calculator could not be loaded." } };
    }
    cards.push(card);
  }
  return { ok: true, value: cards };
}

export async function createPcbCard(name: string, serialNumber: string): Promise<PcbResult<CreatedPcbCard>> {
  const { data, error } = await supabase.rpc("create_pcb_card", {
    p_name: name,
    p_serial_number: serialNumber,
  });
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: { code: "access_denied", message: "You do not have permission to create Finished Product Calculator definitions." } };
    }
    if (error.code === "22023") {
      return { ok: false, error: { code: "invalid_name", message: "Enter a valid Name / Code and exact three-digit Serial Number." } };
    }
    if (error.code === "PCB14") {
      return { ok: false, error: { code: "duplicate_name", message: "A Finished Product Calculator with this Name / Code already exists." } };
    }
    if (error.code === "PRD06" || error.code === "23505") {
      return { ok: false, error: { code: "duplicate_serial", message: "A Product with this Serial Number already exists." } };
    }
    return { ok: false, error: { code: "pcb_create_failed", message: "Finished Product Calculator could not be created." } };
  }
  const row: unknown = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (!isRecord(row) || !isUuid(row.pcb_card_id) || !isUuid(row.product_id) ||
    typeof row.serial_number !== "string" || !calculatorSerialPattern.test(row.serial_number)) {
    return { ok: false, error: { code: "pcb_create_failed", message: "Finished Product Calculator could not be created." } };
  }
  return { ok: true, value: {
    pcbCardId: row.pcb_card_id,
    productId: row.product_id,
    serialNumber: row.serial_number,
  } };
}
