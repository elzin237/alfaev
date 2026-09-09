import { supabase } from "../../../lib/supabase/client";

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
