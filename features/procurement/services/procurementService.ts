import { supabase } from "../../../lib/supabase/client";
import {
  isProcurementStatus,
  type ProcurementStatus,
} from "../procurementStatus";

export interface ProcurementRequestListItem {
  requestId: string;
  productId: string | null;
  productSerialNumber: string | null;
  requestedName: string;
  supplierId: string;
  supplierName: string;
  requestedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
  status: ProcurementStatus;
  createdAt: string;
  createdByUserId: string;
  createdByFullName: string;
}

export interface ProcurementSupplierOption {
  supplierId: string;
  supplierName: string;
}

export interface ProcurementListInput {
  search: string;
  status: ProcurementStatus | null;
  supplierId: string | null;
}

export interface ProcurementReadError {
  code:
    | "procurement_list_failed"
    | "procurement_supplier_options_failed"
    | "procurement_badge_failed";
  message: string;
}

export type ProcurementListResult =
  | { ok: true; value: ProcurementRequestListItem[] }
  | { ok: false; error: ProcurementReadError };

export type ProcurementSupplierOptionsResult =
  | { ok: true; value: ProcurementSupplierOption[] }
  | { ok: false; error: ProcurementReadError };

export type ProcurementBadgeResult =
  | { ok: true; value: number }
  | { ok: false; error: ProcurementReadError };

interface ProcurementRequestRow {
  request_id: string;
  product_id: string | null;
  product_serial_number: string | null;
  requested_name: string;
  supplier_id: string;
  supplier_name: string;
  requested_quantity: unknown;
  delivered_quantity: unknown;
  status: ProcurementStatus;
  created_at: string;
  created_by_user_id: string;
  created_by_full_name: string;
}

interface ProcurementSupplierOptionRow {
  supplier_id: string;
  supplier_name: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseSafeInteger(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;

  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : null;
}

function isProcurementRequestRow(
  value: unknown,
): value is ProcurementRequestRow {
  if (typeof value !== "object" || value === null) return false;

  return (
    "request_id" in value &&
    isUuid(value.request_id) &&
    "product_id" in value &&
    (value.product_id === null || isUuid(value.product_id)) &&
    "product_serial_number" in value &&
    (value.product_serial_number === null ||
      (typeof value.product_serial_number === "string" &&
        /^[0-9]{7}$/.test(value.product_serial_number))) &&
    ((value.product_id === null && value.product_serial_number === null) ||
      (value.product_id !== null && value.product_serial_number !== null)) &&
    "requested_name" in value &&
    isTrimmedNonblank(value.requested_name) &&
    "supplier_id" in value &&
    isUuid(value.supplier_id) &&
    "supplier_name" in value &&
    isTrimmedNonblank(value.supplier_name) &&
    "requested_quantity" in value &&
    parseSafeInteger(value.requested_quantity) !== null &&
    "delivered_quantity" in value &&
    parseSafeInteger(value.delivered_quantity) !== null &&
    "status" in value &&
    isProcurementStatus(value.status) &&
    "created_at" in value &&
    isIsoTimestamp(value.created_at) &&
    "created_by_user_id" in value &&
    isUuid(value.created_by_user_id) &&
    "created_by_full_name" in value &&
    isTrimmedNonblank(value.created_by_full_name)
  );
}

function mapProcurementRequest(
  row: ProcurementRequestRow,
): ProcurementRequestListItem | null {
  const requestedQuantity = parseSafeInteger(row.requested_quantity);
  const deliveredQuantity = parseSafeInteger(row.delivered_quantity);

  if (
    requestedQuantity === null ||
    requestedQuantity <= 0 ||
    deliveredQuantity === null ||
    deliveredQuantity > requestedQuantity
  ) {
    return null;
  }

  return {
    requestId: row.request_id,
    productId: row.product_id,
    productSerialNumber: row.product_serial_number,
    requestedName: row.requested_name,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    requestedQuantity,
    deliveredQuantity,
    remainingQuantity: requestedQuantity - deliveredQuantity,
    status: row.status,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    createdByFullName: row.created_by_full_name,
  };
}

function isProcurementSupplierOptionRow(
  value: unknown,
): value is ProcurementSupplierOptionRow {
  return typeof value === "object" &&
    value !== null &&
    "supplier_id" in value &&
    isUuid(value.supplier_id) &&
    "supplier_name" in value &&
    isTrimmedNonblank(value.supplier_name);
}

function listFailure(): ProcurementListResult {
  return {
    ok: false,
    error: {
      code: "procurement_list_failed",
      message: "The Procurement request list could not be loaded.",
    },
  };
}

function supplierOptionsFailure(): ProcurementSupplierOptionsResult {
  return {
    ok: false,
    error: {
      code: "procurement_supplier_options_failed",
      message: "The Supplier filter could not be loaded.",
    },
  };
}

function badgeFailure(): ProcurementBadgeResult {
  return {
    ok: false,
    error: {
      code: "procurement_badge_failed",
      message: "The Procurement count could not be loaded.",
    },
  };
}

export async function searchProcurementRequests(
  input: ProcurementListInput,
): Promise<ProcurementListResult> {
  try {
    const normalizedSearch = input.search.trim();
    const { data, error } = await supabase.rpc("search_procurement_requests", {
      p_search: normalizedSearch || null,
      p_status: input.status,
      p_supplier_id: input.supplierId,
    });

    if (error || !Array.isArray(data)) return listFailure();

    const requests: ProcurementRequestListItem[] = [];
    for (const row of data) {
      if (!isProcurementRequestRow(row)) return listFailure();
      const request = mapProcurementRequest(row);
      if (!request) return listFailure();
      requests.push(request);
    }

    return { ok: true, value: requests };
  } catch {
    return listFailure();
  }
}

export async function listProcurementSupplierOptions(): Promise<
  ProcurementSupplierOptionsResult
> {
  try {
    const { data, error } = await supabase.rpc(
      "list_procurement_supplier_options",
    );

    if (error || !Array.isArray(data)) return supplierOptionsFailure();
    if (!data.every(isProcurementSupplierOptionRow)) {
      return supplierOptionsFailure();
    }

    return {
      ok: true,
      value: data.map((row) => ({
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
      })),
    };
  } catch {
    return supplierOptionsFailure();
  }
}

export async function getProcurementSidebarBadgeCount(): Promise<
  ProcurementBadgeResult
> {
  try {
    const { data, error } = await supabase.rpc(
      "get_procurement_sidebar_badge_count",
    );
    const count = parseSafeInteger(data);

    if (error || count === null) return badgeFailure();
    return { ok: true, value: count };
  } catch {
    return badgeFailure();
  }
}
