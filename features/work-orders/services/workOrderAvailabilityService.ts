import { isWorkOrderAvailabilityEnabled } from "../../../app/config/workOrderAvailabilityActivation";
import { supabase } from "../../../lib/supabase/client";

export interface MaterialAvailability {
  productId: string; serialNumber: string; productName: string; productIsActive: boolean;
  required: string; eligible: string; missing: string; hasShortage: boolean;
}
export interface WorkOrderAvailability {
  workOrderId: string; workOrderNumber: string; updatedAt: string; asOf: string;
  materials: MaterialAvailability[];
}
export type AvailabilityResult = { ok: true; value: WorkOrderAvailability } |
  { ok: false; error: { code: "access_denied" | "unavailable"; message: string } };
export const availabilityFailure = (denied = false): AvailabilityResult => ({ ok: false,
  error: { code: denied ? "access_denied" : "unavailable", message: "Availability unavailable" } });
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const decimal = (v: unknown, positive = false): v is string => typeof v === "string" &&
  /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 19 && BigInt(v) <= 9223372036854775807n && (!positive || BigInt(v) > 0n);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function keys(v: Record<string, unknown>, fields: string[]) {
  return Object.keys(v).length === fields.length && fields.every(k => Object.prototype.hasOwnProperty.call(v, k));
}
// Preserve microseconds when matching the saved Draft version; never compare rounded dates alone.
export function availabilityTimestamp(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? BigInt(ms) * 1000n + BigInt((v.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3)) : null;
}
export function parseWorkOrderAvailability(data: unknown, id: string): AvailabilityResult {
  if (!record(data) || !keys(data, ["work_order_id", "work_order_number", "status", "updated_at", "as_of", "materials"]) ||
    data.work_order_id !== id || !uuid(id) || data.status !== "draft" || typeof data.work_order_number !== "string" ||
    !/^RN-\d{4}-\d{4}$/.test(data.work_order_number) || availabilityTimestamp(data.updated_at) === null ||
    availabilityTimestamp(data.as_of) === null || !Array.isArray(data.materials)) return availabilityFailure();
  const seen = new Set<string>(), materials: MaterialAvailability[] = [];
  for (const r of data.materials) {
    if (!record(r) || !keys(r, ["product_id", "serial_number", "product_name", "product_is_active", "required_quantity", "eligible_quantity", "missing_quantity", "has_shortage"]) ||
      !uuid(r.product_id) || seen.has(r.product_id) || typeof r.serial_number !== "string" || !/^(?:\d{3}|\d{7})$/.test(r.serial_number) ||
      typeof r.product_name !== "string" || !r.product_name.trim() || typeof r.product_is_active !== "boolean" ||
      !decimal(r.required_quantity, true) || !decimal(r.eligible_quantity) || !decimal(r.missing_quantity) || typeof r.has_shortage !== "boolean") return availabilityFailure();
    const difference = BigInt(r.required_quantity) - BigInt(r.eligible_quantity);
    if (BigInt(r.missing_quantity) !== (difference > 0n ? difference : 0n) || r.has_shortage !== (difference > 0n)) return availabilityFailure();
    seen.add(r.product_id);
    materials.push({ productId: r.product_id, serialNumber: r.serial_number, productName: r.product_name,
      productIsActive: r.product_is_active, required: r.required_quantity, eligible: r.eligible_quantity,
      missing: r.missing_quantity, hasShortage: r.has_shortage });
  }
  return { ok: true, value: { workOrderId: id, workOrderNumber: data.work_order_number,
    updatedAt: data.updated_at as string, asOf: data.as_of as string, materials } };
}
export async function getWorkOrderAvailability(id: string, token: string, signal?: AbortSignal): Promise<AvailabilityResult> {
  if (!isWorkOrderAvailabilityEnabled() || !uuid(id) || !token || signal?.aborted) return availabilityFailure(true);
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const { data, error } = await supabase.rpc("get_work_order_material_availability", { p_work_order_id: id })
      .setHeader("Authorization", `Bearer ${token}`).abortSignal(controller.signal);
    if (controller.signal.aborted) return availabilityFailure();
    return error ? availabilityFailure(error.code === "42501") : parseWorkOrderAvailability(data, id);
  } catch { return availabilityFailure(); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
