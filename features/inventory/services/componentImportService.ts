import { supabase } from "../../../lib/supabase/client";
import type { ComponentImportSubmissionRow } from "../import/componentImportTypes";

export interface ImportedComponent {
  inputIndex: number;
  productId: string;
  serialNumber: string;
}

export interface ComponentImportSuccess {
  createdCount: number;
  products: ImportedComponent[];
}

export interface ComponentImportError {
  code:
    | "access_denied"
    | "brand_unavailable"
    | "import_invalid"
    | "import_failed";
  message: string;
}

export type ComponentImportResult =
  | { ok: true; value: ComponentImportSuccess }
  | { ok: false; error: ComponentImportError };

interface ImportedComponentRow {
  input_index: number;
  product_id: string;
  serial_number: string;
}

function failure(providerCode?: string): ComponentImportResult {
  switch (providerCode) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to import Components.",
        },
      };
    case "PRD04":
      return {
        ok: false,
        error: {
          code: "brand_unavailable",
          message: "A Brand in this workbook is no longer available. Refresh Brands and upload the workbook again.",
        },
      };
    case "22023":
      return {
        ok: false,
        error: {
          code: "import_invalid",
          message: "The Component import is no longer valid. Check the workbook and try again.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "import_failed",
          message: "The Components could not be imported. Please try again.",
        },
      };
  }
}

function isImportedComponentRow(
  value: unknown,
  expectedIndex: number,
): value is ImportedComponentRow {
  return typeof value === "object" && value !== null &&
    Object.keys(value).length === 3 &&
    Object.keys(value).every((key) =>
      ["input_index", "product_id", "serial_number"].includes(key)
    ) &&
    "input_index" in value &&
    Number.isInteger(value.input_index) &&
    value.input_index === expectedIndex &&
    "product_id" in value &&
    typeof value.product_id === "string" &&
    value.product_id.trim().length > 0 &&
    "serial_number" in value &&
    typeof value.serial_number === "string" &&
    /^[0-9]{7}$/.test(value.serial_number);
}

function parseResponse(
  value: unknown,
  expectedCount: number,
): ComponentImportSuccess | null {
  if (!Array.isArray(value) || value.length !== expectedCount) return null;

  const productIds = new Set<string>();
  const serialNumbers = new Set<string>();
  const products: ImportedComponent[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!isImportedComponentRow(row, index + 1)) return null;
    if (productIds.has(row.product_id) || serialNumbers.has(row.serial_number)) {
      return null;
    }
    productIds.add(row.product_id);
    serialNumbers.add(row.serial_number);
    products.push({
      inputIndex: row.input_index,
      productId: row.product_id,
      serialNumber: row.serial_number,
    });
  }

  return { createdCount: products.length, products };
}

export async function importComponents(
  rows: readonly ComponentImportSubmissionRow[],
): Promise<ComponentImportResult> {
  try {
    const { data, error } = await supabase.rpc("bulk_import_components", {
      p_rows: rows,
    });

    if (error) return failure(error.code);
    const value = parseResponse(data, rows.length);
    return value ? { ok: true, value } : failure();
  } catch {
    return failure();
  }
}
