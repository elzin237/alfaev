import { supabase } from "../../../lib/supabase/client";
import { validTestQuantity } from "../testCalculationDraft";

export interface TestPreviewItem { product_id: string; quantity: string }
export interface TestPreviewRow {
  productId: string; name: string; serialNumber: string; productKind: "component" | "pcb_finished_good";
  required: string; eligibleFree: string; projectPriority: string; available: string; reservable: string; missing: string;
  warehouses: { warehouseId: string; warehouseCode: string; quantity: string }[];
}
export interface TestCalculationPreview { rows: TestPreviewRow[]; asOf: string; saveWillRecalculate: true }
export type TestPreviewResult = { ok: true; value: TestCalculationPreview }
  | { ok: false; error: { code: "access_denied" | "invalid_input" | "preview_failed"; message: string } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const warehouseIds: Record<string,string> = {
  raw_materials: "10000000-0000-4000-8000-000000000001",
  finished_goods: "10000000-0000-4000-8000-000000000002",
  customs: "10000000-0000-4000-8000-000000000003",
};
const record = (value: unknown): value is Record<string,unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const decimal = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value);
const failure = (): TestPreviewResult => ({ ok: false, error: { code: "preview_failed", message: "Test Calculation availability could not be verified. Prove the calculation again." } });
const rowKeys = "as_of,eligible_availability,eligible_free_quantity,missing_quantity,name,product_id,product_kind,project_priority_quantity,provisional_warehouse_quantities,required_quantity,reservable_quantity,save_will_recalculate,serial_number";

export async function previewTestCalculation(items: readonly TestPreviewItem[]): Promise<TestPreviewResult> {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100 || items.some(item => !record(item) ||
    Object.keys(item).sort().join(",") !== "product_id,quantity" || typeof item.product_id !== "string" || !uuid.test(item.product_id) ||
    typeof item.quantity !== "string" || !validTestQuantity(item.quantity)) ||
    new Set(items.map(item => item.product_id.toLowerCase())).size !== items.length)
    return { ok: false, error: { code: "invalid_input", message: "Select distinct Products with valid exact quantities." } };
  const payload = items.map(item => ({ product_id: item.product_id.toLowerCase(), quantity: item.quantity }));
  try {
    const { data, error } = await supabase.rpc("preview_test_calculation", { p_items: payload });
    if (error?.code === "42501") return { ok: false, error: { code: "access_denied", message: "You do not have permission to preview these Test Calculation Products." } };
    if (error || !Array.isArray(data) || data.length !== payload.length) return failure();
    const requested = new Map(payload.map(item => [item.product_id,item.quantity])), rows: TestPreviewRow[] = [];
    let asOf: string | undefined;
    for (const row of data) {
      if (!record(row) || Object.keys(row).sort().join(",") !== rowKeys ||
        typeof row.product_id !== "string" || !uuid.test(row.product_id) ||
        !requested.has(row.product_id.toLowerCase()) ||
        typeof row.name !== "string" || !row.name.trim() ||
        typeof row.serial_number !== "string" || !/^(?:[0-9]{3}|[0-9]{7})$/.test(row.serial_number) ||
        !["component","pcb_finished_good"].includes(row.product_kind as string) ||
        typeof row.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.as_of) || !Number.isFinite(Date.parse(row.as_of)) ||
        row.save_will_recalculate !== true || !Array.isArray(row.provisional_warehouse_quantities)) return failure();
      if (asOf !== undefined && asOf !== row.as_of) return failure();
      asOf = row.as_of;
      const quantities = [row.required_quantity,row.eligible_free_quantity,row.project_priority_quantity,row.eligible_availability,row.reservable_quantity,row.missing_quantity];
      if (!quantities.every(decimal)) return failure();
      const [required,free,priority,available,reservable,missing] = quantities as string[];
      if (required !== requested.get(row.product_id.toLowerCase()) ||
        BigInt(available!) !== (BigInt(free!) > BigInt(priority!) ? BigInt(free!) - BigInt(priority!) : 0n) ||
        BigInt(reservable!) !== (BigInt(required!) < BigInt(available!) ? BigInt(required!) : BigInt(available!)) ||
        BigInt(missing!) !== BigInt(required!) - BigInt(reservable!)) return failure();
      const warehouses: TestPreviewRow["warehouses"] = [], codes = new Set<string>();
      for (const hold of row.provisional_warehouse_quantities) {
        if (!record(hold) || Object.keys(hold).sort().join(",") !== "quantity,warehouse_code,warehouse_id" ||
          typeof hold.warehouse_code !== "string" || typeof hold.warehouse_id !== "string" ||
          warehouseIds[hold.warehouse_code] !== hold.warehouse_id || codes.has(hold.warehouse_code) ||
          !decimal(hold.quantity) || BigInt(hold.quantity) > 9223372036854775807n) return failure();
        codes.add(hold.warehouse_code);
        warehouses.push({ warehouseId: hold.warehouse_id, warehouseCode: hold.warehouse_code, quantity: hold.quantity });
      }
      const finished = row.product_kind === "pcb_finished_good";
      if (warehouses.length !== (finished ? 1 : 3) || (finished && (!codes.has("finished_goods") || priority !== "0")) ||
        warehouses.reduce((total,hold) => total + BigInt(hold.quantity),0n) !== BigInt(reservable!)) return failure();
      const productId = row.product_id.toLowerCase(); requested.delete(productId);
      rows.push({ productId, name: row.name, serialNumber: row.serial_number, productKind: row.product_kind as TestPreviewRow["productKind"],
        required: required!, eligibleFree: free!, projectPriority: priority!, available: available!, reservable: reservable!, missing: missing!, warehouses });
    }
    return requested.size === 0 && asOf ? { ok: true, value: { rows, asOf, saveWillRecalculate: true } } : failure();
  } catch { return failure(); }
}
