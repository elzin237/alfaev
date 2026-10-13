import { supabase } from "../../../lib/supabase/client";

export interface InventorySourceChoice {
  productSupplierId: string;
  supplierName: string;
  catalogNumber: string;
  description: string | null;
}

export interface InventorySourceLot {
  id: string;
  sourceKind: "supplier" | "legacy_unknown" | "internal_production";
  receivedAt: string;
  supplierName: string;
  catalogNumber: string | null;
  description: string | null;
  receivedQuantity: bigint;
  remainingQuantity: bigint;
  addedBy: string | null;
}

export type InventorySourceChoicesResult =
  | { ok: true; value: InventorySourceChoice[] }
  | { ok: false; error: { message: string } };
export type InventorySourceLotsResult =
  | { ok: true; value: InventorySourceLot[] }
  | { ok: false; error: { message: string } };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function normalizedOptionalText(value: unknown): value is string | null {
  return value === null || normalizedText(value);
}

function exactQuantity(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  try {
    const quantity = BigInt(value);
    return quantity <= 9_223_372_036_854_775_807n ? quantity : null;
  } catch {
    return null;
  }
}

export async function listInventorySourceChoices(productId: string): Promise<InventorySourceChoicesResult> {
  try {
    const { data, error } = await supabase.rpc("list_active_inventory_source_choices", {
      p_product_id: productId,
    });
    if (error || !Array.isArray(data)) throw new Error();
    const value: InventorySourceChoice[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null ||
        !uuidPattern.test(String(row.product_supplier_id)) ||
        !normalizedText(row.supplier_name) ||
        !normalizedText(row.catalog_number) ||
        !normalizedOptionalText(row.description)) throw new Error();
      value.push({
        productSupplierId: row.product_supplier_id,
        supplierName: row.supplier_name,
        catalogNumber: row.catalog_number,
        description: row.description,
      });
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: { message: "Inventory source choices could not be loaded." } };
  }
}

export async function listInventorySourceLots(productId: string): Promise<InventorySourceLotsResult> {
  try {
    const { data, error } = await supabase.rpc("list_inventory_source_lots", {
      p_product_id: productId,
    });
    if (error || !Array.isArray(data)) throw new Error();
    const value: InventorySourceLot[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null ||
        !uuidPattern.test(String(row.source_lot_id)) ||
        !["supplier", "legacy_unknown", "internal_production"].includes(row.source_kind) ||
        typeof row.received_at !== "string" || !Number.isFinite(Date.parse(row.received_at)) ||
        !normalizedText(row.supplier_name) ||
        !normalizedOptionalText(row.catalog_number) ||
        !normalizedOptionalText(row.description) ||
        !normalizedOptionalText(row.added_by_full_name) ||
        (row.source_kind === "supplier" && row.catalog_number === null) ||
        (row.source_kind !== "supplier" && row.catalog_number !== null)) throw new Error();
      const receivedQuantity = exactQuantity(row.received_quantity);
      const remainingQuantity = exactQuantity(row.remaining_quantity);
      if (receivedQuantity === null || receivedQuantity <= 0n || remainingQuantity === null || remainingQuantity > receivedQuantity) throw new Error();
      value.push({
        id: row.source_lot_id,
        sourceKind: row.source_kind as InventorySourceLot["sourceKind"],
        receivedAt: row.received_at,
        supplierName: row.supplier_name,
        catalogNumber: row.catalog_number,
        description: row.description,
        receivedQuantity,
        remainingQuantity,
        addedBy: row.added_by_full_name,
      });
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: { message: "Supplier Stock History could not be loaded." } };
  }
}
