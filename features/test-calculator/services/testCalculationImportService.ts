import { supabase } from "../../../lib/supabase/client";
import { isTestCalculationImportEnabled } from "../../../app/config/testCalculationImportActivation";
import { testUuid } from "./testCalculationSaveService";
import { historyTimestampMicros } from "./testCalculationHistoryService";

export interface TestImportRequest { requestId: string; calculationId: string; serialNumber: string }
export interface TestImportReceipt {
  import_id: string; calculation_id: string; name: string; pcb_card_id: string; output_product_id: string;
  initial_bom_version_id: string; initial_bom_version_number: "1"; serial_number: string; imported_at: string;
  release_allocations: { item_id: string; product_id: string; warehouse_id: string; quantity: string }[];
  release_totals: { product_id: string; quantity: string }[];
}
export type TestImportResult = { ok: true; value: TestImportReceipt } |
  { ok: false; error: { code: string; uncertain: boolean; message: string } };
const exact = (v: unknown, keys: string): v is Record<string, unknown> => Boolean(v && typeof v === "object" &&
  !Array.isArray(v) && Object.keys(v).sort().join() === keys.split(",").sort().join());
export const validImportSerial = (v: unknown): v is string => typeof v === "string" && /^[0-9]{3}$/.test(v);
export const validTestImportRequest = (v: unknown): v is TestImportRequest => exact(v, "requestId,calculationId,serialNumber") &&
  testUuid(v.requestId) && testUuid(v.calculationId) && validImportSerial(v.serialNumber);
const positive = (v: unknown, max: bigint): v is string => typeof v === "string" && /^[1-9][0-9]{0,19}$/.test(v) && BigInt(v) <= max;
const maxBigint = 9223372036854775807n;
const warehouses = new Set(["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"]);

export function parseTestImportReceipt(data: unknown, request: TestImportRequest): TestImportReceipt | null {
  if (!validTestImportRequest(request) || !exact(data, "import_id,calculation_id,name,pcb_card_id,output_product_id,initial_bom_version_id,initial_bom_version_number,serial_number,imported_at,release_allocations,release_totals") ||
    !testUuid(data.import_id) || data.calculation_id !== request.calculationId || !testUuid(data.pcb_card_id) ||
    !testUuid(data.output_product_id) || !testUuid(data.initial_bom_version_id) || data.initial_bom_version_number !== "1" ||
    data.serial_number !== request.serialNumber || typeof data.name !== "string" || !data.name.trim() || data.name !== data.name.trim() ||
    historyTimestampMicros(data.imported_at) === null || !Array.isArray(data.release_allocations) || data.release_allocations.length > 300 ||
    !Array.isArray(data.release_totals) || data.release_totals.length > 100) return null;
  const pairs = new Set<string>(), itemProducts = new Map<string, string>(), productItems = new Map<string, string>(), sums = new Map<string, bigint>();
  for (const a of data.release_allocations) {
    if (!exact(a, "item_id,product_id,warehouse_id,quantity") || !testUuid(a.item_id) || !testUuid(a.product_id) ||
      typeof a.warehouse_id !== "string" || !warehouses.has(a.warehouse_id) || !positive(a.quantity, maxBigint) ||
      pairs.has(`${a.product_id}:${a.warehouse_id}`) || (itemProducts.has(a.item_id) && itemProducts.get(a.item_id) !== a.product_id) ||
      (productItems.has(a.product_id) && productItems.get(a.product_id) !== a.item_id)) return null;
    pairs.add(`${a.product_id}:${a.warehouse_id}`); itemProducts.set(a.item_id, a.product_id); productItems.set(a.product_id, a.item_id);
    sums.set(a.product_id, (sums.get(a.product_id) ?? 0n) + BigInt(a.quantity));
  }
  if (sums.size !== data.release_totals.length) return null;
  for (const t of data.release_totals) {
    if (!exact(t, "product_id,quantity") || !testUuid(t.product_id) || !positive(t.quantity, maxBigint * 3n) || sums.get(t.product_id) !== BigInt(t.quantity)) return null;
    sums.delete(t.product_id);
  }
  return sums.size ? null : data as unknown as TestImportReceipt;
}
const failure = (code: string, uncertain: boolean): TestImportResult => ({ ok: false, error: { code, uncertain,
  message: uncertain ? "Import outcome is uncertain. Recover the original request; do not create a replacement." :
    "Import was not completed. Check authorization, source eligibility and the unique three-digit serial." } });
export async function importTestCalculation(request: TestImportRequest, accessToken: string): Promise<TestImportResult> {
  if (!isTestCalculationImportEnabled()) return failure("feature_disabled", false);
  if (!validTestImportRequest(request) || !accessToken) return failure("invalid_request", false);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const { data, error } = await supabase.rpc("import_test_calculation", {
      p_request_id: request.requestId, p_calculation_id: request.calculationId, p_serial_number: request.serialNumber,
    }).setHeader("Authorization", `Bearer ${accessToken}`).abortSignal(controller.signal);
    if (error) {
      // These codes confirm rejection of THIS attempt, not the outcome of an earlier uncertain attempt.
      return ["42501", "22023", "TCI02", "TCI03", "P0002", "PCB14", "PRD06", "PGRST202", "42883"].includes(error.code) ?
        failure(error.code, false) : failure("outcome_uncertain", true);
    }
    const receipt = parseTestImportReceipt(data, request);
    return receipt ? { ok: true, value: receipt } : failure("outcome_uncertain", true);
  } catch { return failure("outcome_uncertain", true); }
  finally { clearTimeout(timer); }
}
