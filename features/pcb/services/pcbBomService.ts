import { supabase } from "../../../lib/supabase/client";

export type BomProductKind = "component" | "pcb_finished_good";

export interface PcbBomItem {
  itemId: string;
  productId: string;
  name: string;
  serialNumber: string;
  productKind: BomProductKind;
  isActive: boolean;
  currentStock: string;
  quantityPerCard: string;
}

export interface PcbBomDetail {
  cardId: string;
  name: string;
  isActive: boolean;
  outputProductId: string;
  outputSerialNumber: string;
  outputCurrentStock: string;
  versionId: string | null;
  versionNumber: number | null;
  items: PcbBomItem[];
}

export interface PcbBomProductChoice {
  productId: string;
  name: string;
  serialNumber: string;
  productKind: BomProductKind;
  currentStock: string;
}

export interface PcbBomSaveItem {
  productId: string;
  quantityPerCard: string;
}

export interface PcbBomError {
  code: "not_found" | "access_denied" | "card_archived" | "bom_unavailable" |
    "product_unavailable" | "invalid_items" | "duplicate_product" | "read_failed" |
    "choices_failed" | "save_failed";
  message: string;
}

export type PcbBomResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PcbBomError };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const serialPattern = /^[0-9]{7}$/;
const bigintMax = 9223372036854775807n;

export function isPcbCardId(value: string): boolean {
  return uuidPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isSerial(value: unknown): value is string {
  return typeof value === "string" && serialPattern.test(value);
}

function isKind(value: unknown): value is BomProductKind {
  return value === "component" || value === "pcb_finished_good";
}

function isBigintText(value: unknown, positive: boolean): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  const integer = BigInt(value);
  return integer <= bigintMax && (!positive || integer > 0n);
}

export function parseEditableQuantity(value: string): string | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const normalized = value.replace(/^0+/, "");
  if (!normalized || normalized.length > 19) return null;
  return BigInt(normalized) <= bigintMax ? normalized : null;
}

const readError: PcbBomError = { code: "read_failed", message: "PCB BOM could not be loaded." };

export async function getPcbBomEditor(cardId: string): Promise<PcbBomResult<PcbBomDetail>> {
  if (!isPcbCardId(cardId)) {
    return { ok: false, error: { code: "not_found", message: "PCB Card not found." } };
  }
  const { data, error } = await supabase.rpc("get_pcb_bom_editor", { p_pcb_card_id: cardId });
  if (error?.code === "P0002") {
    return { ok: false, error: { code: "not_found", message: "PCB Card not found." } };
  }
  if (error || !Array.isArray(data) || data.length === 0) return { ok: false, error: readError };

  let detail: PcbBomDetail | null = null;
  const seenProducts = new Set<string>();
  for (const value of data) {
    if (!isRecord(value) || !isUuid(value.card_id) || value.card_id !== cardId ||
      !isName(value.card_name) ||
      typeof value.card_is_active !== "boolean" || !isUuid(value.output_product_id) ||
      !isSerial(value.output_serial_number) || !isBigintText(value.output_current_stock, false) ||
      !((value.active_bom_version_id === null && value.active_bom_version_number === null) ||
        (isUuid(value.active_bom_version_id) && value.active_bom_version_number === "1"))) {
      return { ok: false, error: readError };
    }
    if (!detail) {
      detail = {
        cardId: value.card_id, name: value.card_name, isActive: value.card_is_active,
        outputProductId: value.output_product_id, outputSerialNumber: value.output_serial_number,
        outputCurrentStock: value.output_current_stock,
        versionId: value.active_bom_version_id,
        versionNumber: value.active_bom_version_id === null ? null : 1,
        items: [],
      };
    } else if (detail.cardId !== value.card_id || detail.name !== value.card_name ||
      detail.isActive !== value.card_is_active || detail.outputProductId !== value.output_product_id ||
      detail.outputSerialNumber !== value.output_serial_number ||
      detail.outputCurrentStock !== value.output_current_stock ||
      detail.versionId !== value.active_bom_version_id) {
      return { ok: false, error: readError };
    }
    if (value.bom_item_id === null) {
      if (value.input_product_id !== null || value.input_product_name !== null ||
        value.input_serial_number !== null || value.input_product_kind !== null ||
        value.input_product_is_active !== null || value.input_current_stock !== null ||
        value.quantity_per_card !== null || data.length !== 1) {
        return { ok: false, error: readError };
      }
      continue;
    }
    if (!detail.versionId || !isUuid(value.bom_item_id) || !isUuid(value.input_product_id) ||
      !isName(value.input_product_name) || !isSerial(value.input_serial_number) ||
      !isKind(value.input_product_kind) || typeof value.input_product_is_active !== "boolean" ||
      !isBigintText(value.input_current_stock, false) ||
      !isBigintText(value.quantity_per_card, true) ||
      value.input_product_id === detail.outputProductId || seenProducts.has(value.input_product_id)) {
      return { ok: false, error: readError };
    }
    seenProducts.add(value.input_product_id);
    detail.items.push({
      itemId: value.bom_item_id, productId: value.input_product_id,
      name: value.input_product_name, serialNumber: value.input_serial_number,
      productKind: value.input_product_kind, isActive: value.input_product_is_active,
      currentStock: value.input_current_stock, quantityPerCard: value.quantity_per_card,
    });
  }
  return detail ? { ok: true, value: detail } : { ok: false, error: readError };
}

export async function searchPcbBomProductChoices(
  cardId: string,
  search: string,
): Promise<PcbBomResult<PcbBomProductChoice[]>> {
  if (!isPcbCardId(cardId)) return { ok: false, error: { code: "not_found", message: "PCB Card not found." } };
  const { data, error } = await supabase.rpc("search_pcb_bom_product_choices", {
    p_pcb_card_id: cardId, p_search: search.trim(),
  });
  if (error || !Array.isArray(data)) {
    return { ok: false, error: { code: "choices_failed", message: "Products could not be loaded." } };
  }
  const choices: PcbBomProductChoice[] = [];
  const seen = new Set<string>();
  for (const value of data) {
    if (!isRecord(value) || !isUuid(value.product_id) || !isName(value.product_name) ||
      !isSerial(value.serial_number) || !isKind(value.product_kind) ||
      !isBigintText(value.current_stock, false) || seen.has(value.product_id)) {
      return { ok: false, error: { code: "choices_failed", message: "Products could not be loaded." } };
    }
    seen.add(value.product_id);
    choices.push({ productId: value.product_id, name: value.product_name,
      serialNumber: value.serial_number, productKind: value.product_kind,
      currentStock: value.current_stock });
  }
  return { ok: true, value: choices };
}

export async function saveInitialPcbBom(
  cardId: string,
  items: PcbBomSaveItem[],
): Promise<PcbBomResult<{ versionId: string; versionNumber: 1 }>> {
  if (!isPcbCardId(cardId) || new Set(items.map((item) => item.productId)).size !== items.length) {
    return { ok: false, error: { code: "invalid_items", message: "Enter valid, unique BOM Products and quantities." } };
  }
  const payload: Array<{ product_id: string; quantity_per_card: string }> = [];
  for (const item of items) {
    const quantity = parseEditableQuantity(item.quantityPerCard);
    if (!isUuid(item.productId) || quantity === null) {
      return { ok: false, error: { code: "invalid_items", message: "Enter valid, unique BOM Products and quantities." } };
    }
    payload.push({ product_id: item.productId, quantity_per_card: quantity });
  }
  const { data, error } = await supabase.rpc("save_initial_pcb_bom", {
    p_pcb_card_id: cardId,
    p_items: payload,
  });
  if (error) {
    const mapped: Record<string, PcbBomError> = {
      "42501": { code: "access_denied", message: "You do not have permission to edit this PCB BOM." },
      P0002: { code: "not_found", message: "PCB Card not found." },
      PCB07: { code: "card_archived", message: "This PCB Card is archived." },
      PCB06: { code: "bom_unavailable", message: "This PCB BOM can no longer be edited here." },
      PCB04: { code: "product_unavailable", message: "A selected Product is unavailable." },
      PCB05: { code: "invalid_items", message: "The PCB Card cannot consume its own output Product." },
      "22023": { code: "invalid_items", message: "Enter valid BOM Products and quantities." },
      "23505": { code: "duplicate_product", message: "A Product appears more than once in this BOM." },
    };
    return { ok: false, error: mapped[error.code] ?? { code: "save_failed", message: "PCB BOM could not be saved." } };
  }
  const row: unknown = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (!isRecord(row) || !isUuid(row.bom_version_id) ||
    !(row.version_number === 1 || row.version_number === "1")) {
    return { ok: false, error: { code: "save_failed", message: "PCB BOM could not be saved." } };
  }
  return { ok: true, value: { versionId: row.bom_version_id, versionNumber: 1 } };
}
