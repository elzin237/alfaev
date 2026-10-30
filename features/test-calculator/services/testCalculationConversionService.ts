import { supabase } from "../../../lib/supabase/client";
import { isTestCalculationImportEnabled } from "../../../app/config/testCalculationImportActivation";
import { testUuid } from "./testCalculationSaveService";
import { historyTimestampMicros } from "./testCalculationHistoryService";
export interface TestConversion {
  calculation_id: string; imported: boolean; can_navigate: boolean;
  destination: null | { calculator_id: string; product_id: string; serial_number: string; imported_at: string };
  items: { item_id: string; product_id: string; effective_quantity: string; warehouses: { warehouse_id: string; quantity: string }[] }[];
}
export interface TestConversions { as_of: string; next_expiry: string | null; rows: TestConversion[] }
const exact = (v: unknown, fields: string): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === fields.split(",").sort().join());
const uint = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const warehouseIds = new Set(["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"]);
export function parseTestConversions(value: unknown, ids: readonly string[], commitments = false): TestConversions | null {
  if (!exact(value,"as_of,next_expiry,rows") || historyTimestampMicros(value.as_of) === null ||
    !(value.next_expiry === null || historyTimestampMicros(value.next_expiry) !== null && historyTimestampMicros(value.next_expiry)! > historyTimestampMicros(value.as_of)!) ||
    !Array.isArray(value.rows) || value.rows.length !== ids.length) return null;
  const remaining = new Set(ids);
  for (const row of value.rows) {
    if (!exact(row,"calculation_id,imported,can_navigate,destination,items") || !testUuid(row.calculation_id) || !remaining.delete(row.calculation_id) ||
      typeof row.imported !== "boolean" || typeof row.can_navigate !== "boolean" || row.can_navigate && !row.imported ||
      !Array.isArray(row.items) || (commitments ? row.items.length < 1 || row.items.length > 100 : row.items.length !== 0)) return null;
    if (row.can_navigate) {
      const d = row.destination;
      if (!exact(d,"calculator_id,product_id,serial_number,imported_at") || !testUuid(d.calculator_id) || !testUuid(d.product_id) ||
        typeof d.serial_number !== "string" || !/^[0-9]{3}$/.test(d.serial_number) || historyTimestampMicros(d.imported_at) === null || historyTimestampMicros(d.imported_at)! > historyTimestampMicros(value.as_of)!) return null;
    } else if (row.destination !== null) return null;
    const products = new Set<string>(), items = new Set<string>();
    for (const item of row.items) {
      if (!exact(item,"item_id,product_id,effective_quantity,warehouses") || !testUuid(item.item_id) || !testUuid(item.product_id) || items.has(item.item_id) || products.has(item.product_id) ||
        !uint(item.effective_quantity) || !Array.isArray(item.warehouses) || item.warehouses.length > 3) return null;
      items.add(item.item_id); products.add(item.product_id); const seen = new Set<string>(); let total = 0n;
      for (const w of item.warehouses) {
        if (!exact(w,"warehouse_id,quantity") || typeof w.warehouse_id !== "string" || !warehouseIds.has(w.warehouse_id) || seen.has(w.warehouse_id) || !uint(w.quantity) || w.quantity === "0") return null;
        seen.add(w.warehouse_id); total += BigInt(w.quantity);
      }
      if (total !== BigInt(item.effective_quantity)) return null;
    }
  }
  return remaining.size ? null : value as unknown as TestConversions;
}
export async function getTestConversions(ids: readonly string[], token: string, commitments = false, signal?: AbortSignal): Promise<TestConversions> {
  if (!isTestCalculationImportEnabled() || !token || ids.length < 1 || ids.length > 100 || !ids.every(testUuid) || new Set(ids).size !== ids.length || commitments && ids.length !== 1) throw Error("Conversion metadata unavailable");
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort,15000);
  signal?.addEventListener("abort",abort,{once:true}); if (signal?.aborted) abort();
  try {
    const { data,error } = await supabase.rpc("get_test_calculation_conversions", { p_calculation_ids: ids, p_include_commitments: commitments })
      .setHeader("Authorization",`Bearer ${token}`).abortSignal(controller.signal);
    const parsed = !error && parseTestConversions(data,ids,commitments);
    if (!parsed) throw Error("Conversion metadata unavailable"); return parsed;
  } catch { throw Error("Conversion metadata unavailable"); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort",abort); }
}
