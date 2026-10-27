import { supabase } from "../../../lib/supabase/client";
import { historyTimestampMicros } from "../../test-calculator/services/testCalculationHistoryService";
import { testUuid } from "../../test-calculator/services/testCalculationSaveService";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";

export interface InventoryTestCommitment {
  productId: string;
  warehouseId: string;
  quantityScope: string;
  physicalQuantity: string;
  projectCommitmentQuantity: string;
  availableAfterProjects: string;
  committedToTests: string;
  availableAfterProjectsAndTests: string;
  asOf: string;
  nextExpiry: string | null;
}
export type InventoryTestResult = { ok: true; value: InventoryTestCommitment[] } |
  { ok: false; error: { code: "access_denied" | "load_failed"; message: string } };
export const inventoryTestFailure = (denied = false): InventoryTestResult => ({ ok: false, error: {
  code: denied ? "access_denied" : "load_failed",
  message: denied ? "You do not have the warehouse permissions required to read Test commitments." :
    "Test commitments could not be verified. Combined availability is unavailable. Try again.",
} });
const keys = "product_id,warehouse_id,quantity_scope,physical_quantity,project_commitment_quantity,available_after_projects,committed_to_tests,available_after_projects_and_tests,as_of,next_expiry".split(",").sort().join();
const unsigned = (v: unknown): v is string => typeof v === "string" && /^(?:0|[1-9][0-9]*)$/.test(v);
const signed = (v: unknown): v is string => unsigned(v) || typeof v === "string" && /^-[1-9][0-9]*$/.test(v);

export async function getInventoryTestCommitments(warehouseId: string, search: string, token: string, signal?: AbortSignal): Promise<InventoryTestResult> {
  const warehouse = INVENTORY_WAREHOUSES.find(w => w.id === warehouseId);
  if (!warehouse || !token) return inventoryTestFailure(true);
  const controller = new AbortController(), abort = () => controller.abort();
  const timer = setTimeout(abort, 15_000);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const { data, error } = await supabase.rpc("get_inventory_test_commitments", {
      p_warehouse_id: warehouseId, p_search: search.trim() || null,
    }).setHeader("Authorization", `Bearer ${token}`).abortSignal(controller.signal);
    if (error) return inventoryTestFailure(error.code === "42501");
    if (!Array.isArray(data)) return inventoryTestFailure();
    const rows: InventoryTestCommitment[] = [], ids = new Set<string>();
    const scope = { raw_materials: "raw_customs_planning", finished_goods: "finished_goods_reservations", customs: "customs_physical" }[warehouse.code];
    for (const r of data) {
      if (!r || typeof r !== "object" || Object.keys(r).sort().join() !== keys || !testUuid(r.product_id) || ids.has(r.product_id) ||
        r.warehouse_id !== warehouseId || r.quantity_scope !== scope || !unsigned(r.physical_quantity) ||
        !unsigned(r.project_commitment_quantity) || !unsigned(r.committed_to_tests) || !signed(r.available_after_projects) ||
        !signed(r.available_after_projects_and_tests)) return inventoryTestFailure();
      const asOf = historyTimestampMicros(r.as_of), expiry = historyTimestampMicros(r.next_expiry);
      if (asOf === null || (rows[0] && rows[0].asOf !== r.as_of) ||
        (r.next_expiry !== null && (expiry === null || expiry <= asOf)) ||
        ((r.committed_to_tests === "0") !== (r.next_expiry === null))) return inventoryTestFailure();
      ids.add(r.product_id);
      rows.push({ productId: r.product_id, warehouseId, quantityScope: scope, physicalQuantity: r.physical_quantity,
        projectCommitmentQuantity: r.project_commitment_quantity, availableAfterProjects: r.available_after_projects,
        committedToTests: r.committed_to_tests, availableAfterProjectsAndTests: r.available_after_projects_and_tests,
        asOf: r.as_of, nextExpiry: r.next_expiry });
    }
    return { ok: true, value: rows };
  } catch { return inventoryTestFailure(); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
