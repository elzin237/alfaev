import { supabase } from "../../../lib/supabase/client";
import { isProjectId } from "./projectService";

export const SQL_BIGINT_MAX = 9223372036854775807n;
export const FINISHED_GOODS_WAREHOUSE_ID = "10000000-0000-4000-8000-000000000002";
export type ReservationOperation = "reserve" | "release" | "fulfill";
export interface ReservationRequest {
  readonly operation: ReservationOperation;
  readonly projectId: string;
  readonly productId: string;
  readonly quantity: bigint;
  readonly expectedVersion: bigint;
  readonly requestId: string;
  readonly reservationId: string | null;
}
export interface ReservationReceipt {
  reservationId: string;
  projectId: string;
  productId: string;
  reservedQuantity: bigint;
  reservationVersion: bigint;
  eventId: string;
  movementId?: string;
  physicalQuantityBefore?: bigint;
  physicalQuantityAfter?: bigint;
}
export type ReservationMutationResult = { ok: true; value: ReservationReceipt } | {
  ok: false;
  error: { code: string; message: string; uncertain: boolean };
};
export const reservationReceiptProjection = "reservation_id,project_id,product_id,reserved_quantity::text,reservation_version::text,event_id";
export const fulfillmentReceiptProjection = `${reservationReceiptProjection},movement_id,physical_quantity_before::text,physical_quantity_after::text`;
const rpcNames = {
  reserve: "reserve_finished_goods_for_project",
  release: "release_finished_goods_project_reservation",
  fulfill: "fulfill_finished_goods_project_reservation",
} as const;
const messages: Record<string, string> = {
  FGR01: "This request does not match its original operation. Do not submit it as a new operation.",
  FGR02: "This Project is closed for reservation changes.",
  FGR03: "This Finished Product is unavailable. Archived Products can only have reservations released.",
  FGR04: "The reservation changed. Review refreshed quantities before making a new decision.",
  FGR05: "The quantity exceeds this Project's reservation.",
  FGR06: "The quantity exceeds eligible outstanding Project demand.",
  FGR07: "There is insufficient unreserved Finished Goods stock.",
  FGR08: "Resolve outstanding reservations before completing this Project.",
  FGR09: "Fulfillment could not be validated. No changes were accepted.",
  "42501": "You do not have access to this operation, or reservation mutations are not activated on this backend.",
  "22023": "Enter a positive whole quantity and a valid reservation request.",
  "22003": "The quantity or reservation version exceeds the supported range. Refresh before making a new decision.",
  P0002: "The Project or reservation could not be found. Refresh before trying again.",
  PGRST202: "Reservation mutations are not available on this backend yet.",
  "42883": "Reservation mutations are not available on this backend yet.",
};
function failure(code?: string): ReservationMutationResult {
  if (code && messages[code]) return { ok: false, error: { code, message: messages[code], uncertain: false } };
  if (code && /^IV[BL][0-9]{2}$/.test(code)) return { ok: false, error: {
    code, message: "Inventory could not be validated. Refresh the current stock before making another decision.", uncertain: false,
  } };
  // Transport errors, timeouts and unrecognized/malformed responses may follow a
  // committed transaction. Never convert them into permission to make a new request.
  return { ok: false, error: { code: "outcome_uncertain", uncertain: true,
    message: "The outcome is uncertain. Retry only the exact original request to reconcile it; do not create a replacement operation." } };
}
function integer(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length > 19 || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const result = BigInt(value);
  return result <= SQL_BIGINT_MAX ? result : null;
}
export function parseReservationQuantity(value: string): bigint | null {
  const result = integer(value);
  return result !== null && result > 0n ? result : null;
}
function parseReceipt(data: unknown, input: ReservationRequest): ReservationReceipt | null {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") return null;
  const row = data[0] as Record<string, unknown>;
  const projection = input.operation === "fulfill" ? fulfillmentReceiptProjection : reservationReceiptProjection;
  const fields = projection.split(",").map(field => field.replace("::text", ""));
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) return null;
  for (const field of ["reservation_id", "project_id", "product_id", "event_id"])
    if (typeof row[field] !== "string" || !isProjectId(row[field])) return null;
  if (row.project_id !== input.projectId || row.product_id !== input.productId ||
    (input.reservationId !== null && row.reservation_id !== input.reservationId)) return null;
  const reserved = integer(row.reserved_quantity), version = integer(row.reservation_version);
  if (reserved === null || version !== input.expectedVersion + 1n) return null;
  const result: ReservationReceipt = { reservationId: row.reservation_id as string, projectId: input.projectId,
    productId: input.productId, reservedQuantity: reserved, reservationVersion: version, eventId: row.event_id as string };
  if (input.operation === "fulfill") {
    const before = integer(row.physical_quantity_before), after = integer(row.physical_quantity_after);
    if (typeof row.movement_id !== "string" || !isProjectId(row.movement_id) || before === null || after === null ||
      before - after !== input.quantity) return null;
    Object.assign(result, { movementId: row.movement_id, physicalQuantityBefore: before, physicalQuantityAfter: after });
  }
  return result;
}

async function mutate(input: ReservationRequest, accessToken?: string): Promise<ReservationMutationResult> {
  if (!rpcNames[input.operation] || ![input.projectId, input.productId, input.requestId].every(isProjectId) ||
    typeof input.quantity !== "bigint" || input.quantity <= 0n || input.quantity > SQL_BIGINT_MAX ||
    typeof input.expectedVersion !== "bigint" || input.expectedVersion < 0n || input.expectedVersion > SQL_BIGINT_MAX ||
    (input.reservationId !== null && !isProjectId(input.reservationId)) ||
    (input.reservationId === null && input.expectedVersion !== 0n) ||
    (input.reservationId !== null && input.expectedVersion < 1n) ||
    (input.operation !== "reserve" && input.reservationId === null)) return failure("22023");
  const parameters = { p_project_id: input.projectId, p_product_id: input.productId,
    p_quantity: input.quantity.toString(), p_expected_version: input.expectedVersion.toString(), p_request_id: input.requestId,
    ...(input.operation === "fulfill" ? { p_reservation_id: input.reservationId } : {}) };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const query = supabase.rpc(rpcNames[input.operation], parameters)
      .select(input.operation === "fulfill" ? fulfillmentReceiptProjection : reservationReceiptProjection);
    // The hook captures the current identity's token in memory only. Pinning the
    // header prevents a global client session switch from re-attributing a replay.
    if (accessToken) query.setHeader("Authorization", `Bearer ${accessToken}`);
    const { data, error } = await query.abortSignal(controller.signal);
    if (error) return failure(error.code);
    const receipt = parseReceipt(data, input);
    return receipt ? { ok: true, value: receipt } : failure();
  } catch { return failure(); }
  finally { clearTimeout(timeout); }
}
export const reserveFinishedGoods = (input: Omit<ReservationRequest, "operation">, accessToken?: string) => mutate({ ...input, operation: "reserve" }, accessToken);
export const releaseFinishedGoods = (input: Omit<ReservationRequest, "operation">, accessToken?: string) => mutate({ ...input, operation: "release" }, accessToken);
export const fulfillFinishedGoods = (input: Omit<ReservationRequest, "operation">, accessToken?: string) => mutate({ ...input, operation: "fulfill" }, accessToken);

// Reuse the existing warehouse-authorized detail RPC, narrowing the projection.
// Migration 146 intentionally does not expose archive metadata. No name heuristic.
export async function getFinishedGoodsActiveState(productId: string): Promise<boolean | null> {
  if (!isProjectId(productId)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const { data, error } = await supabase.rpc("get_inventory_product_by_warehouse", {
      p_product_id: productId, p_warehouse_id: FINISHED_GOODS_WAREHOUSE_ID,
    }).select("product_id,is_active").abortSignal(controller.signal);
    if (error || !Array.isArray(data) || data.length !== 1 || data[0]?.product_id !== productId ||
      typeof data[0].is_active !== "boolean") return null;
    return data[0].is_active;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}
