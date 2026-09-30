import { supabase } from "../../../lib/supabase/client";
import { isWorkOrderId, isWorkOrderNumber } from "./workOrderService";

export interface FinishedWorkOrderDetail {
  id: string;
  workOrderNumber: string;
  projectId: string;
  projectName: string;
  customerName: string;
  description: string;
  createdAt: string;
  finishedAt: string;
  finishedByUserId: string;
  finishedByFullName: string;
  pdf: {
    id: string;
    documentVersion: 1;
    generatedAt: string;
  } | null;
}

export interface FinishedWorkOrderMaterial {
  productId: string;
  serialNumber: string;
  productName: string;
  quantity: string;
}

export interface FinishedWorkOrderMovement {
  movementId: string;
  productId: string;
  serialNumber: string;
  productName: string;
  quantityDelta: string;
  quantityBefore: string;
  quantityAfter: string;
  createdAt: string;
}

export interface FinishedWorkOrderReadError {
  code:
    | "access_denied"
    | "finished_work_order_read_failed"
    | "invalid_request"
    | "work_order_not_finished"
    | "work_order_not_found";
  message: string;
}

export type FinishedWorkOrderDetailResult =
  | { ok: true; value: FinishedWorkOrderDetail }
  | { ok: false; error: FinishedWorkOrderReadError };

export type FinishedWorkOrderMaterialsResult =
  | { ok: true; value: FinishedWorkOrderMaterial[] }
  | { ok: false; error: FinishedWorkOrderReadError };

export type FinishedWorkOrderMovementsResult =
  | { ok: true; value: FinishedWorkOrderMovement[] }
  | { ok: false; error: FinishedWorkOrderReadError };

const detailKeys = new Set([
  "work_order_id",
  "work_order_number",
  "project_id",
  "project_name",
  "customer_name_snapshot",
  "description",
  "created_at",
  "finished_at",
  "finished_by_user_id",
  "finished_by_full_name",
  "pdf_id",
  "document_version",
  "generated_at",
]);
const materialKeys = new Set([
  "product_id",
  "serial_number",
  "product_name",
  "quantity",
]);
const movementKeys = new Set([
  "movement_id",
  "product_id",
  "serial_number",
  "product_name",
  "quantity_delta",
  "quantity_before",
  "quantity_after",
  "created_at",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const serialNumberPattern = /^[0-9]{7}$/;
const postgresBigintMax = 9223372036854775807n;
const postgresBigintMin = -9223372036854775808n;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>) {
  return Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function parseNonnegativeBigint(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    BigInt(value) > postgresBigintMax
  ) return null;
  return value;
}

function parsePositiveBigint(value: unknown): string | null {
  const parsed = parseNonnegativeBigint(value);
  return parsed !== null && parsed !== "0" ? parsed : null;
}

function parseSignedBigint(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^-?(0|[1-9][0-9]*)$/.test(value) ||
    value === "-0"
  ) return null;
  const parsed = BigInt(value);
  return parsed >= postgresBigintMin && parsed <= postgresBigintMax
    ? value
    : null;
}

function parseDetail(value: unknown): FinishedWorkOrderDetail | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, detailKeys) ||
    !isWorkOrderId(value.work_order_id) ||
    !isWorkOrderNumber(value.work_order_number) ||
    !isUuid(value.project_id) ||
    !isTrimmedNonblank(value.project_name) ||
    !isTrimmedNonblank(value.customer_name_snapshot) ||
    !isTrimmedNonblank(value.description) ||
    !isTimestamp(value.created_at) ||
    !isTimestamp(value.finished_at) ||
    !isUuid(value.finished_by_user_id) ||
    !isTrimmedNonblank(value.finished_by_full_name)
  ) return null;

  const pdfId = value.pdf_id;
  const documentVersion = value.document_version;
  const generatedAt = value.generated_at;
  const hasNoPdf = pdfId === null &&
    documentVersion === null && generatedAt === null;
  const hasPdf = isUuid(pdfId) && documentVersion === 1 &&
    isTimestamp(generatedAt);
  if (!hasNoPdf && !hasPdf) return null;

  return {
    id: value.work_order_id,
    workOrderNumber: value.work_order_number,
    projectId: value.project_id,
    projectName: value.project_name,
    customerName: value.customer_name_snapshot,
    description: value.description,
    createdAt: value.created_at,
    finishedAt: value.finished_at,
    finishedByUserId: value.finished_by_user_id,
    finishedByFullName: value.finished_by_full_name,
    pdf: hasPdf
      ? {
        id: pdfId,
        documentVersion: 1,
        generatedAt,
      }
      : null,
  };
}

function parseMaterial(value: unknown): FinishedWorkOrderMaterial | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, materialKeys) ||
    !isUuid(value.product_id) ||
    typeof value.serial_number !== "string" ||
    !serialNumberPattern.test(value.serial_number) ||
    !isTrimmedNonblank(value.product_name)
  ) return null;
  const quantity = parsePositiveBigint(value.quantity);
  return quantity === null
    ? null
    : {
      productId: value.product_id,
      serialNumber: value.serial_number,
      productName: value.product_name,
      quantity,
    };
}

function parseMovement(value: unknown): FinishedWorkOrderMovement | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, movementKeys) ||
    !isUuid(value.movement_id) ||
    !isUuid(value.product_id) ||
    typeof value.serial_number !== "string" ||
    !serialNumberPattern.test(value.serial_number) ||
    !isTrimmedNonblank(value.product_name) ||
    !isTimestamp(value.created_at)
  ) return null;
  const quantityDelta = parseSignedBigint(value.quantity_delta);
  const quantityBefore = parseNonnegativeBigint(value.quantity_before);
  const quantityAfter = parseNonnegativeBigint(value.quantity_after);
  if (
    quantityDelta === null || BigInt(quantityDelta) >= 0n ||
    quantityBefore === null || quantityAfter === null ||
    BigInt(quantityAfter) !== BigInt(quantityBefore) + BigInt(quantityDelta)
  ) return null;
  return {
    movementId: value.movement_id,
    productId: value.product_id,
    serialNumber: value.serial_number,
    productName: value.product_name,
    quantityDelta,
    quantityBefore,
    quantityAfter,
    createdAt: value.created_at,
  };
}

function readFailure(code?: string): FinishedWorkOrderReadError {
  if (code === "42501") return {
    code: "access_denied",
    message: "You no longer have permission to view this Finished Work Order.",
  };
  if (code === "P0002") return {
    code: "work_order_not_found",
    message: "The Work Order could not be found.",
  };
  if (code === "WOR10") return {
    code: "work_order_not_finished",
    message: "This Work Order is not Finished.",
  };
  if (code === "22023") return {
    code: "invalid_request",
    message: "The Finished Work Order request is invalid.",
  };
  return {
    code: "finished_work_order_read_failed",
    message: "The Finished Work Order could not be loaded. Please try again.",
  };
}

export async function getFinishedWorkOrderDetail(
  workOrderId: string,
): Promise<FinishedWorkOrderDetailResult> {
  try {
    const { data, error } = await supabase.rpc(
      "get_finished_work_order_detail",
      { p_work_order_id: workOrderId },
    );
    if (error) return { ok: false, error: readFailure(error.code) };
    if (!Array.isArray(data) || data.length !== 1) {
      return { ok: false, error: readFailure() };
    }
    const detail = parseDetail(data[0]);
    return detail
      ? { ok: true, value: detail }
      : { ok: false, error: readFailure() };
  } catch {
    return { ok: false, error: readFailure() };
  }
}

export async function listFinishedWorkOrderMaterials(
  workOrderId: string,
): Promise<FinishedWorkOrderMaterialsResult> {
  try {
    const { data, error } = await supabase.rpc(
      "list_finished_work_order_materials",
      { p_work_order_id: workOrderId },
    );
    if (error) return { ok: false, error: readFailure(error.code) };
    if (!Array.isArray(data)) return { ok: false, error: readFailure() };
    const materials: FinishedWorkOrderMaterial[] = [];
    for (const row of data) {
      const material = parseMaterial(row);
      if (!material) return { ok: false, error: readFailure() };
      materials.push(material);
    }
    return { ok: true, value: materials };
  } catch {
    return { ok: false, error: readFailure() };
  }
}

export async function listFinishedWorkOrderMovements(
  workOrderId: string,
): Promise<FinishedWorkOrderMovementsResult> {
  try {
    const { data, error } = await supabase.rpc(
      "list_finished_work_order_movements",
      { p_work_order_id: workOrderId },
    );
    if (error) return { ok: false, error: readFailure(error.code) };
    if (!Array.isArray(data)) return { ok: false, error: readFailure() };
    const movements: FinishedWorkOrderMovement[] = [];
    for (const row of data) {
      const movement = parseMovement(row);
      if (!movement) return { ok: false, error: readFailure() };
      movements.push(movement);
    }
    return { ok: true, value: movements };
  } catch {
    return { ok: false, error: readFailure() };
  }
}
