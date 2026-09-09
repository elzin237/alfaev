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

export interface ProductListError {
  code: "product_list_failed";
  message: string;
}

export type ProductListResult =
  | { ok: true; value: Product[] }
  | { ok: false; error: ProductListError };

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

interface CreatedProductRow {
  product_id: string;
  serial_number: string;
}

interface ProductRow {
  id: string;
  serial_number: string;
  name: string;
  category: string;
  brand_id: string | null;
  brand: { name: string } | null;
  product_kind: ProductKind;
  is_active: boolean;
}

function isProductKind(value: unknown): value is ProductKind {
  return value === "component" || value === "pcb_finished_good";
}

function isProductRow(value: unknown): value is ProductRow {
  if (typeof value !== "object" || value === null) return false;

  const brandIsValid =
    "brand" in value &&
    (
      value.brand === null ||
      (
        typeof value.brand === "object" &&
        "name" in value.brand &&
        typeof value.brand.name === "string"
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
    typeof value.is_active === "boolean"
  );
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    serialNumber: row.serial_number,
    name: row.name,
    category: row.category,
    brandId: row.brand_id,
    brandName: row.brand?.name ?? null,
    productKind: row.product_kind,
    isActive: row.is_active,
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

export async function listProducts(): Promise<ProductListResult> {
  try {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id,serial_number,name,category,brand_id,product_kind,is_active,brand:brands(name)",
      )
      .order("serial_number", { ascending: true });

    if (error || !Array.isArray(data)) {
      return listFailure();
    }

    const products: Product[] = [];
    for (const row of data) {
      if (!isProductRow(row)) return listFailure();
      products.push(mapProduct(row));
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
