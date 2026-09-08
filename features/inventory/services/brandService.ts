import { supabase } from "../../../lib/supabase/client";

interface BrandRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Brand {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface BrandServiceError {
  code:
    | "access_denied"
    | "brand_archived"
    | "brand_duplicate"
    | "brand_invalid"
    | "brand_not_found"
    | "brand_list_failed"
    | "brand_mutation_failed";
  message: string;
}

export type BrandListResult =
  | { ok: true; value: Brand[] }
  | { ok: false; error: BrandServiceError };

export type BrandMutationResult =
  | { ok: true; value: { brandId: string } }
  | { ok: false; error: BrandServiceError };

function isBrandRow(value: unknown): value is BrandRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "is_active" in value &&
    typeof value.is_active === "boolean" &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    "updated_at" in value &&
    typeof value.updated_at === "string" &&
    "archived_at" in value &&
    (typeof value.archived_at === "string" || value.archived_at === null)
  );
}

function mapBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function compareBrands(left: Brand, right: Brand): number {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }

  const nameComparison = left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });

  return nameComparison || left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id);
}

function listFailure(): BrandListResult {
  return {
    ok: false,
    error: {
      code: "brand_list_failed",
      message: "The Brand list could not be loaded.",
    },
  };
}

function mutationFailure(code?: string): BrandMutationResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to manage Brands.",
        },
      };
    case "BRN01":
      return {
        ok: false,
        error: {
          code: "brand_archived",
          message: "Archived Brands cannot be changed.",
        },
      };
    case "BRN02":
      return {
        ok: false,
        error: {
          code: "brand_duplicate",
          message: "A Brand with this name already exists.",
        },
      };
    case "22023":
      return {
        ok: false,
        error: {
          code: "brand_invalid",
          message: "Enter a valid Brand name.",
        },
      };
    case "P0002":
      return {
        ok: false,
        error: {
          code: "brand_not_found",
          message: "The Brand could not be found.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "brand_mutation_failed",
          message: "The Brand could not be saved. Please try again.",
        },
      };
  }
}

export async function listBrands(): Promise<BrandListResult> {
  try {
    const { data, error } = await supabase
      .from("brands")
      .select("id,name,is_active,created_at,updated_at,archived_at");

    if (error || !Array.isArray(data) || !data.every(isBrandRow)) {
      return listFailure();
    }

    return { ok: true, value: data.map(mapBrand).sort(compareBrands) };
  } catch {
    return listFailure();
  }
}

async function runBrandMutation(
  rpcName: "create_brand" | "update_brand" | "archive_brand",
  parameters: Record<string, string>,
): Promise<BrandMutationResult> {
  try {
    const { data, error } = await supabase.rpc(rpcName, parameters);

    if (error) {
      return mutationFailure(error.code);
    }

    if (typeof data !== "string") {
      return mutationFailure();
    }

    return { ok: true, value: { brandId: data } };
  } catch {
    return mutationFailure();
  }
}

export function createBrand(name: string): Promise<BrandMutationResult> {
  return runBrandMutation("create_brand", { p_name: name.trim() });
}

export function updateBrand(
  brandId: string,
  name: string,
): Promise<BrandMutationResult> {
  return runBrandMutation("update_brand", {
    p_brand_id: brandId,
    p_name: name.trim(),
  });
}

export function archiveBrand(brandId: string): Promise<BrandMutationResult> {
  return runBrandMutation("archive_brand", { p_brand_id: brandId });
}
