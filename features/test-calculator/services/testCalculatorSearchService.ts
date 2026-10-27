import { supabase } from "../../../lib/supabase/client";

export interface TestCalculatorProduct {
  productId: string;
  name: string;
  serialNumber: string;
  productKind: "component" | "pcb_finished_good";
  sourcePolicy: "raw_customs_fg" | "finished_goods_only";
}
export type TestProductSearchResult =
  | { ok: true; value: TestCalculatorProduct[] }
  | { ok: false; error: { code: "access_denied" | "search_failed"; message: string } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = (): TestProductSearchResult => ({ ok: false, error: {
  code: "search_failed", message: "Eligible Products could not be loaded.",
} });

export async function searchTestCalculatorProducts(search: string, limit = 50): Promise<TestProductSearchResult> {
  const term = search.trim();
  if (term.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100) return failure();
  try {
    const { data, error } = await supabase.rpc("search_test_calculator_products", {
      p_search: term || null, p_limit: limit,
    });
    if (error?.code === "42501") return { ok: false, error: {
      code: "access_denied", message: "You do not have permission to search these Test Calculator Products.",
    } };
    if (error || !Array.isArray(data) || data.length > limit) return failure();
    const products: TestCalculatorProduct[] = [], ids = new Set<string>();
    for (const row of data) {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
        Object.keys(row).sort().join(",") !== "name,product_id,product_kind,serial_number,source_policy" ||
        typeof row.product_id !== "string" || !uuid.test(row.product_id) ||
        typeof row.name !== "string" || !row.name.trim() || row.name !== row.name.trim() ||
        typeof row.serial_number !== "string" || !/^(?:[0-9]{3}|[0-9]{7})$/.test(row.serial_number) ||
        !((row.product_kind === "component" && row.source_policy === "raw_customs_fg") ||
          (row.product_kind === "pcb_finished_good" && row.source_policy === "finished_goods_only"))) return failure();
      const id = row.product_id.toLowerCase();
      if (ids.has(id)) return failure();
      ids.add(id);
      products.push({ productId: id, name: row.name, serialNumber: row.serial_number,
        productKind: row.product_kind, sourcePolicy: row.source_policy });
    }
    return { ok: true, value: products };
  } catch { return failure(); }
}
