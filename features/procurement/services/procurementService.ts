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
  supplierId: string | null;
  supplierName: string | null;
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

export interface ProcurementProductChoice {
  productId: string;
  serialNumber: string;
  name: string;
}

export interface ProcurementActiveSupplierChoice {
  supplierId: string;
  supplierName: string;
}

export interface CreateProcurementRequestForProductInput {
  productId: string;
  requestedQuantity: number;
}

export interface CreateProcurementRequestForNewComponentInput {
  requestedName: string;
  requestedQuantity: number;
}

export interface CreatedProcurementRequest {
  requestId: string;
}

export interface UpdateProcurementDeliveredQuantityInput {
  requestId: string;
  deliveredQuantity: number;
}

export interface UpdatedProcurementDelivery {
  requestId: string;
}

export interface ResolvedProcurementRequest {
  requestId: string;
}

export interface CreateProductFromProcurementRequestInput {
  requestId: string;
  name: string;
  category: string;
  brandId: string | null;
}

export interface CreatedProductFromProcurementRequest {
  productId: string;
  serialNumber: string;
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
    | "procurement_product_choices_failed"
    | "procurement_active_supplier_choices_failed"
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

export type ProcurementProductChoicesResult =
  | { ok: true; value: ProcurementProductChoice[] }
  | { ok: false; error: ProcurementReadError };

export type ProcurementActiveSupplierChoicesResult =
  | { ok: true; value: ProcurementActiveSupplierChoice[] }
  | { ok: false; error: ProcurementReadError };

export interface ProcurementCreationError {
  code:
    | "access_denied"
    | "product_unavailable"
    | "invalid_request"
    | "procurement_creation_failed";
  message: string;
}

export type ProcurementCreationResult =
  | { ok: true; value: CreatedProcurementRequest }
  | { ok: false; error: ProcurementCreationError };

export interface ProcurementDeliveryUpdateError {
  code:
    | "access_denied"
    | "invalid_quantity"
    | "request_not_found"
    | "request_resolved"
    | "delivery_update_failed";
  message: string;
}

export type ProcurementDeliveryUpdateResult =
  | { ok: true; value: UpdatedProcurementDelivery }
  | { ok: false; error: ProcurementDeliveryUpdateError };

export interface ProcurementResolveError {
  code:
    | "access_denied"
    | "invalid_request"
    | "request_not_found"
    | "already_resolved"
    | "procurement_resolve_failed";
  message: string;
}

export type ProcurementResolveResult =
  | { ok: true; value: ResolvedProcurementRequest }
  | { ok: false; error: ProcurementResolveError };

export interface ProcurementProductCreationError {
  code:
    | "access_denied"
    | "invalid_product"
    | "request_not_found"
    | "request_resolved"
    | "request_already_linked"
    | "supplier_unavailable"
    | "brand_unavailable"
    | "product_creation_failed";
  message: string;
}

export type ProcurementProductCreationResult =
  | { ok: true; value: CreatedProductFromProcurementRequest }
  | { ok: false; error: ProcurementProductCreationError };

interface ProcurementRequestRow {
  request_id: string;
  product_id: string | null;
  product_serial_number: string | null;
  requested_name: string;
  supplier_id: string | null;
  supplier_name: string | null;
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

interface ProcurementProductChoiceRow {
  product_id: string;
  serial_number: string;
  name: string;
}

interface CreatedProductFromProcurementRequestRow {
  product_id: string;
  serial_number: string;
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
        /^(?:[0-9]{3}|[0-9]{7})$/.test(value.product_serial_number))) &&
    ((value.product_id === null && value.product_serial_number === null) ||
      (value.product_id !== null && value.product_serial_number !== null)) &&
    "requested_name" in value &&
    isTrimmedNonblank(value.requested_name) &&
    "supplier_id" in value &&
    (value.supplier_id === null || isUuid(value.supplier_id)) &&
    "supplier_name" in value &&
    (value.supplier_name === null || isTrimmedNonblank(value.supplier_name)) &&
    ((value.supplier_id === null && value.supplier_name === null) ||
      (value.supplier_id !== null && value.supplier_name !== null)) &&
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

function isProcurementProductChoiceRow(
  value: unknown,
): value is ProcurementProductChoiceRow {
  return typeof value === "object" &&
    value !== null &&
    "product_id" in value &&
    isUuid(value.product_id) &&
    "serial_number" in value &&
    typeof value.serial_number === "string" &&
    /^(?:[0-9]{3}|[0-9]{7})$/.test(value.serial_number) &&
    "name" in value &&
    isTrimmedNonblank(value.name);
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

function productChoicesFailure(): ProcurementProductChoicesResult {
  return {
    ok: false,
    error: {
      code: "procurement_product_choices_failed",
      message: "The Product choices could not be loaded.",
    },
  };
}

function activeSupplierChoicesFailure(): ProcurementActiveSupplierChoicesResult {
  return {
    ok: false,
    error: {
      code: "procurement_active_supplier_choices_failed",
      message: "The Supplier choices could not be loaded.",
    },
  };
}

function creationFailure(code?: string): ProcurementCreationResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to create Procurement requests.",
        },
      };
    case "PRQ03":
      return {
        ok: false,
        error: {
          code: "product_unavailable",
          message: "The selected Product is unavailable. Choose an active Product.",
        },
      };
    case "22003":
    case "22023":
    case "23514":
      return {
        ok: false,
        error: {
          code: "invalid_request",
          message: "Enter a valid Product and positive whole-number quantity.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "procurement_creation_failed",
          message: "The Procurement request could not be created. Please try again.",
        },
      };
  }
}

function newComponentCreationFailure(code?: string): ProcurementCreationResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to create Procurement requests.",
        },
      };
    case "22003":
    case "22023":
    case "23514":
      return {
        ok: false,
        error: {
          code: "invalid_request",
          message: "Enter a valid Component Name and positive whole-number quantity.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "procurement_creation_failed",
          message: "The Procurement request could not be created. Please try again.",
        },
      };
  }
}

function deliveryUpdateFailure(code?: string): ProcurementDeliveryUpdateResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to update delivered quantity.",
        },
      };
    case "22023":
    case "23514":
      return {
        ok: false,
        error: {
          code: "invalid_quantity",
          message: "Delivered So Far must be a whole number within the requested quantity.",
        },
      };
    case "P0002":
      return {
        ok: false,
        error: {
          code: "request_not_found",
          message: "The Procurement request could not be found.",
        },
      };
    case "PRQ02":
      return {
        ok: false,
        error: {
          code: "request_resolved",
          message: "Resolved Procurement requests cannot be changed.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "delivery_update_failed",
          message: "Delivered quantity could not be updated. Please try again.",
        },
      };
  }
}

function resolveFailure(code?: string): ProcurementResolveResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to resolve Procurement requests.",
        },
      };
    case "22023":
      return {
        ok: false,
        error: {
          code: "invalid_request",
          message: "Select a valid Procurement request.",
        },
      };
    case "P0002":
      return {
        ok: false,
        error: {
          code: "request_not_found",
          message: "The Procurement request could not be found.",
        },
      };
    case "PRQ02":
      return {
        ok: false,
        error: {
          code: "already_resolved",
          message: "This Procurement request is already resolved.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "procurement_resolve_failed",
          message: "The Procurement request could not be resolved. Please try again.",
        },
      };
  }
}

function procurementProductCreationFailure(
  code?: string,
): ProcurementProductCreationResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "Only an active Admin can create a Product from this request.",
        },
      };
    case "22023":
    case "23514":
      return {
        ok: false,
        error: {
          code: "invalid_product",
          message: "Enter a valid Product Name and Category.",
        },
      };
    case "P0002":
      return {
        ok: false,
        error: {
          code: "request_not_found",
          message: "The Procurement request could not be found.",
        },
      };
    case "PRQ02":
      return {
        ok: false,
        error: {
          code: "request_resolved",
          message: "Resolved Procurement requests cannot create Products.",
        },
      };
    case "PRQ05":
      return {
        ok: false,
        error: {
          code: "request_already_linked",
          message: "This Procurement request already has a Product.",
        },
      };
    case "PRQ04":
      return {
        ok: false,
        error: {
          code: "supplier_unavailable",
          message: "The request Supplier is no longer available for a new Product.",
        },
      };
    case "PRD04":
      return {
        ok: false,
        error: {
          code: "brand_unavailable",
          message: "The selected Brand is unavailable. Choose an active Brand or no Brand.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "product_creation_failed",
          message: "The Product could not be created from this request. Please try again.",
        },
      };
  }
}

function isCreatedProductFromProcurementRequestRow(
  value: unknown,
): value is CreatedProductFromProcurementRequestRow {
  return typeof value === "object" &&
    value !== null &&
    "product_id" in value &&
    isUuid(value.product_id) &&
    "serial_number" in value &&
    typeof value.serial_number === "string" &&
    /^(?:[0-9]{3}|[0-9]{7})$/.test(value.serial_number);
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

export async function searchProcurementProductChoices(
  search = "",
): Promise<ProcurementProductChoicesResult> {
  try {
    const normalizedSearch = search.trim();
    const { data, error } = await supabase.rpc(
      "search_procurement_product_choices",
      { p_search: normalizedSearch || null },
    );

    if (error || !Array.isArray(data) ||
      !data.every(isProcurementProductChoiceRow)) {
      return productChoicesFailure();
    }

    return {
      ok: true,
      value: data.map((row) => ({
        productId: row.product_id,
        serialNumber: row.serial_number,
        name: row.name,
      })),
    };
  } catch {
    return productChoicesFailure();
  }
}

export async function listActiveProcurementSupplierChoices(): Promise<
  ProcurementActiveSupplierChoicesResult
> {
  try {
    const { data, error } = await supabase.rpc(
      "list_active_procurement_supplier_choices",
    );

    if (error || !Array.isArray(data) ||
      !data.every(isProcurementSupplierOptionRow)) {
      return activeSupplierChoicesFailure();
    }

    return {
      ok: true,
      value: data.map((row) => ({
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
      })),
    };
  } catch {
    return activeSupplierChoicesFailure();
  }
}

export async function createProcurementRequestForProduct(
  input: CreateProcurementRequestForProductInput,
): Promise<ProcurementCreationResult> {
  try {
    const { data, error } = await supabase.rpc(
      "create_procurement_request_for_product",
      {
        p_product_id: input.productId,
        p_requested_quantity: input.requestedQuantity,
      },
    );

    if (error) return creationFailure(error.code);
    if (!isUuid(data)) return creationFailure();

    return { ok: true, value: { requestId: data } };
  } catch {
    return creationFailure();
  }
}

export async function createProcurementRequestForNewComponent(
  input: CreateProcurementRequestForNewComponentInput,
): Promise<ProcurementCreationResult> {
  try {
    const { data, error } = await supabase.rpc(
      "create_procurement_request_for_new_component",
      {
        p_requested_name: input.requestedName.trim(),
        p_requested_quantity: input.requestedQuantity,
      },
    );

    if (error) return newComponentCreationFailure(error.code);
    if (!isUuid(data)) return newComponentCreationFailure();

    return { ok: true, value: { requestId: data } };
  } catch {
    return newComponentCreationFailure();
  }
}

export async function updateProcurementDeliveredQuantity(
  input: UpdateProcurementDeliveredQuantityInput,
): Promise<ProcurementDeliveryUpdateResult> {
  try {
    const { data, error } = await supabase.rpc(
      "update_procurement_delivered_quantity",
      {
        p_request_id: input.requestId,
        p_delivered_quantity: input.deliveredQuantity,
      },
    );

    if (error) return deliveryUpdateFailure(error.code);
    if (!isUuid(data)) return deliveryUpdateFailure();

    return { ok: true, value: { requestId: data } };
  } catch {
    return deliveryUpdateFailure();
  }
}

export async function resolveProcurementRequest(
  requestId: string,
): Promise<ProcurementResolveResult> {
  try {
    const { data, error } = await supabase.rpc(
      "resolve_procurement_request",
      { p_request_id: requestId },
    );

    if (error) return resolveFailure(error.code);
    if (!isUuid(data)) return resolveFailure();

    return { ok: true, value: { requestId: data } };
  } catch {
    return resolveFailure();
  }
}

export async function createProductFromProcurementRequest(
  input: CreateProductFromProcurementRequestInput,
): Promise<ProcurementProductCreationResult> {
  try {
    const { data, error } = await supabase.rpc(
      "create_product_from_procurement_request",
      {
        p_request_id: input.requestId,
        p_name: input.name.trim(),
        p_category: input.category.trim(),
        p_brand_id: input.brandId?.trim() || null,
      },
    );

    if (error) return procurementProductCreationFailure(error.code);
    if (
      !Array.isArray(data) ||
      data.length !== 1 ||
      !isCreatedProductFromProcurementRequestRow(data[0])
    ) {
      return procurementProductCreationFailure();
    }

    return {
      ok: true,
      value: {
        productId: data[0].product_id,
        serialNumber: data[0].serial_number,
      },
    };
  } catch {
    return procurementProductCreationFailure();
  }
}
