import { supabase } from "../../../lib/supabase/client";

export type ProductKind = "component" | "pcb_finished_good";

export interface Product {
  id: string;
  serialNumber: string;
  name: string;
  category: string;
  brandId: string | null;
  brandName: string | null;
  productKind: ProductKind;
  isActive: boolean;
}

export interface ProductListItem {
  id: string;
  serialNumber: string;
  name: string;
  category: string;
  brandName: string | null;
  productKind: ProductKind;
  isActive: boolean;
  quantity: number;
}

export interface ProductDetail extends Product {
  brandIsActive: boolean | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProductListError {
  code: "product_list_failed";
  message: string;
}

export type ProductListResult =
  | { ok: true; value: ProductListItem[] }
  | { ok: false; error: ProductListError };

export interface ProductDetailError {
  code: "product_not_found" | "product_detail_failed";
  message: string;
}

export type ProductDetailResult =
  | { ok: true; value: ProductDetail }
  | { ok: false; error: ProductDetailError };

export interface CreateProductInput {
  name: string;
  category: string;
  brandId: string | null;
}

export interface CreatedProduct {
  productId: string;
  serialNumber: string;
}

export interface ProductCreationError {
  code:
    | "access_denied"
    | "brand_unavailable"
    | "product_invalid"
    | "product_creation_failed";
  message: string;
}

export type ProductCreationResult =
  | { ok: true; value: CreatedProduct }
  | { ok: false; error: ProductCreationError };

export interface UpdateProductInput {
  name: string;
  category: string;
  brandId: string | null;
}

export interface ProductUpdateError {
  code:
    | "access_denied"
    | "product_archived"
    | "brand_unavailable"
    | "product_invalid"
    | "product_not_found"
    | "product_update_failed";
  message: string;
}

export type ProductUpdateResult =
  | { ok: true; value: { productId: string } }
  | { ok: false; error: ProductUpdateError };

export interface ProductArchiveError {
  code:
    | "access_denied"
    | "product_archived"
    | "product_not_found"
    | "product_archive_failed";
  message: string;
}

export type ProductArchiveResult =
  | { ok: true; value: { productId: string } }
  | { ok: false; error: ProductArchiveError };

interface CreatedProductRow {
  product_id: string;
  serial_number: string;
}

interface ProductRow {
  id: string;
  serial_number: string;
  name: string;
  category: string;
  brand_name: string | null;
  product_kind: ProductKind;
  is_active: boolean;
  quantity: unknown;
}

interface ProductDetailRow {
  id: string;
  serial_number: string;
  name: string;
  category: string;
  brand_id: string | null;
  brand: { name: string; is_active: boolean } | null;
  product_kind: ProductKind;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

const productDetailFields =
  "id,serial_number,name,category,brand_id,product_kind,is_active,created_at,updated_at,archived_at,brand:brands(name,is_active)";

function isDateTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isProductKind(value: unknown): value is ProductKind {
  return value === "component" || value === "pcb_finished_good";
}

function parseQuantity(value: unknown): number | null {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;

  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : null;
}

function isProductRow(value: unknown): value is ProductRow {
  if (typeof value !== "object" || value === null) return false;

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "serial_number" in value &&
    typeof value.serial_number === "string" &&
    /^[0-9]{7}$/.test(value.serial_number) &&
    "name" in value &&
    typeof value.name === "string" &&
    "category" in value &&
    typeof value.category === "string" &&
    "brand_name" in value &&
    (typeof value.brand_name === "string" || value.brand_name === null) &&
    "product_kind" in value &&
    isProductKind(value.product_kind) &&
    "is_active" in value &&
    typeof value.is_active === "boolean" &&
    "quantity" in value &&
    parseQuantity(value.quantity) !== null
  );
}

function mapProduct(row: ProductRow): ProductListItem | null {
  const quantity = parseQuantity(row.quantity);
  if (quantity === null) return null;

  return {
    id: row.id,
    serialNumber: row.serial_number,
    name: row.name,
    category: row.category,
    brandName: row.brand_name,
    productKind: row.product_kind,
    isActive: row.is_active,
    quantity,
  };
}

function isProductDetailRow(value: unknown): value is ProductDetailRow {
  if (typeof value !== "object" || value === null) return false;

  const brandIsValid =
    "brand" in value &&
    (
      value.brand === null ||
      (
        typeof value.brand === "object" &&
        "name" in value.brand &&
        typeof value.brand.name === "string" &&
        "is_active" in value.brand &&
        typeof value.brand.is_active === "boolean"
      )
    );

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "serial_number" in value &&
    typeof value.serial_number === "string" &&
    /^[0-9]{7}$/.test(value.serial_number) &&
    "name" in value &&
    typeof value.name === "string" &&
    "category" in value &&
    typeof value.category === "string" &&
    "brand_id" in value &&
    (typeof value.brand_id === "string" || value.brand_id === null) &&
    brandIsValid &&
    "product_kind" in value &&
    isProductKind(value.product_kind) &&
    "is_active" in value &&
    typeof value.is_active === "boolean" &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    isDateTime(value.created_at) &&
    "updated_at" in value &&
    typeof value.updated_at === "string" &&
    isDateTime(value.updated_at) &&
    "archived_at" in value &&
    (
      value.archived_at === null ||
      (typeof value.archived_at === "string" && isDateTime(value.archived_at))
    )
  );
}

function mapProductDetail(row: ProductDetailRow): ProductDetail {
  return {
    id: row.id,
    serialNumber: row.serial_number,
    name: row.name,
    category: row.category,
    brandId: row.brand_id,
    brandName: row.brand?.name ?? null,
    brandIsActive: row.brand?.is_active ?? null,
    productKind: row.product_kind,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function listFailure(): ProductListResult {
  return {
    ok: false,
    error: {
      code: "product_list_failed",
      message: "The Product list could not be loaded.",
    },
  };
}

function isCreatedProductRow(value: unknown): value is CreatedProductRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "product_id" in value &&
    typeof value.product_id === "string" &&
    value.product_id.length > 0 &&
    "serial_number" in value &&
    typeof value.serial_number === "string" &&
    /^[0-9]{7}$/.test(value.serial_number)
  );
}

function creationFailure(code?: string): ProductCreationResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to add Components.",
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
    case "22023":
      return {
        ok: false,
        error: {
          code: "product_invalid",
          message: "Enter valid Component information.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "product_creation_failed",
          message: "The Component could not be created. Please try again.",
        },
      };
  }
}

function updateFailure(code?: string): ProductUpdateResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to edit Products.",
        },
      };
    case "PRD01":
      return {
        ok: false,
        error: {
          code: "product_archived",
          message: "Archived Products cannot be edited.",
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
    case "22023":
      return {
        ok: false,
        error: {
          code: "product_invalid",
          message: "Enter valid Product information.",
        },
      };
    case "P0002":
      return {
        ok: false,
        error: {
          code: "product_not_found",
          message: "The Product could not be found.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "product_update_failed",
          message: "The Product could not be updated. Please try again.",
        },
      };
  }
}

function archiveFailure(code?: string): ProductArchiveResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to archive Products.",
        },
      };
    case "PRD01":
      return {
        ok: false,
        error: {
          code: "product_archived",
          message: "This Product is already archived and cannot be archived again.",
        },
      };
    case "P0002":
      return {
        ok: false,
        error: {
          code: "product_not_found",
          message: "The Product could not be found.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "product_archive_failed",
          message: "The Product could not be archived. Please try again.",
        },
      };
  }
}

export async function createProduct(
  input: CreateProductInput,
): Promise<ProductCreationResult> {
  try {
    const { data, error } = await supabase.rpc("create_product", {
      p_name: input.name.trim(),
      p_category: input.category.trim(),
      p_brand_id: input.brandId?.trim() || null,
    });

    if (error) {
      return creationFailure(error.code);
    }

    if (
      !Array.isArray(data) ||
      data.length !== 1 ||
      !isCreatedProductRow(data[0])
    ) {
      return creationFailure();
    }

    return {
      ok: true,
      value: {
        productId: data[0].product_id,
        serialNumber: data[0].serial_number,
      },
    };
  } catch {
    return creationFailure();
  }
}

export async function listProducts(search = ""): Promise<ProductListResult> {
  try {
    const normalizedSearch = search.trim();
    const { data, error } = await supabase.rpc("search_inventory_products", {
      p_search: normalizedSearch || null,
    });

    if (error || !Array.isArray(data)) {
      return listFailure();
    }

    const products: ProductListItem[] = [];
    for (const row of data) {
      if (!isProductRow(row)) return listFailure();
      const product = mapProduct(row);
      if (product === null) return listFailure();
      products.push(product);
    }

    return {
      ok: true,
      value: products.sort((left, right) =>
        left.serialNumber.localeCompare(right.serialNumber)),
    };
  } catch {
    return listFailure();
  }
}

export async function getProduct(
  productId: string,
): Promise<ProductDetailResult> {
  try {
    const { data, error } = await supabase
      .from("products")
      .select(productDetailFields)
      .eq("id", productId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        error: {
          code: "product_detail_failed",
          message: "The Product details could not be loaded.",
        },
      };
    }

    if (data === null) {
      return {
        ok: false,
        error: {
          code: "product_not_found",
          message: "The Product could not be found.",
        },
      };
    }

    if (!isProductDetailRow(data)) {
      return {
        ok: false,
        error: {
          code: "product_detail_failed",
          message: "The Product details could not be loaded.",
        },
      };
    }

    return { ok: true, value: mapProductDetail(data) };
  } catch {
    return {
      ok: false,
      error: {
        code: "product_detail_failed",
        message: "The Product details could not be loaded.",
      },
    };
  }
}

export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
): Promise<ProductUpdateResult> {
  try {
    const { data, error } = await supabase.rpc("update_product", {
      p_product_id: productId,
      p_name: input.name.trim(),
      p_category: input.category.trim(),
      p_brand_id: input.brandId?.trim() || null,
    });

    if (error) return updateFailure(error.code);
    if (typeof data !== "string" || data.length === 0) return updateFailure();

    return { ok: true, value: { productId: data } };
  } catch {
    return updateFailure();
  }
}

export async function archiveProduct(
  productId: string,
): Promise<ProductArchiveResult> {
  try {
    const { data, error } = await supabase.rpc("archive_product", {
      p_product_id: productId,
    });

    if (error) return archiveFailure(error.code);
    if (typeof data !== "string" || data.length === 0) return archiveFailure();

    return { ok: true, value: { productId: data } };
  } catch {
    return archiveFailure();
  }
}
