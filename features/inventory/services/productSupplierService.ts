import { supabase } from "../../../lib/supabase/client";

export interface ProductSupplierRelation {
  relationId: string;
  supplierId: string;
  supplierName: string;
  catalogNumber: string | null;
  description: string | null;
  isActive: boolean;
  supplierIsActive: boolean;
}

export interface ProductSupplierChoice {
  supplierId: string;
  supplierName: string;
}

export interface SupplierProductRelation {
  relationId: string;
  productId: string;
  productSerialNumber: string;
  productName: string;
  productIsActive: boolean;
  catalogNumber: string | null;
  description: string | null;
  isActive: boolean;
}

export interface ProductSupplierProductChoice {
  productId: string;
  serialNumber: string;
  productName: string;
}

export interface CreateProductSupplierInput {
  productId: string;
  supplierId: string;
}

export interface ProductSupplierServiceError {
  code:
    | "access_denied"
    | "product_unavailable"
    | "supplier_unavailable"
    | "relationship_archived"
    | "relationship_duplicate"
    | "relationship_not_found"
    | "relationship_list_failed"
    | "supplier_choice_list_failed"
    | "product_link_list_failed"
    | "product_choice_list_failed"
    | "relationship_create_failed"
    | "relationship_archive_failed";
  message: string;
}

export type ProductSupplierListResult =
  | { ok: true; value: ProductSupplierRelation[] }
  | { ok: false; error: ProductSupplierServiceError };

export type ProductSupplierChoiceListResult =
  | { ok: true; value: ProductSupplierChoice[] }
  | { ok: false; error: ProductSupplierServiceError };

export type SupplierProductListResult =
  | { ok: true; value: SupplierProductRelation[] }
  | { ok: false; error: ProductSupplierServiceError };

export type ProductSupplierProductChoiceListResult =
  | { ok: true; value: ProductSupplierProductChoice[] }
  | { ok: false; error: ProductSupplierServiceError };

export type ProductSupplierMutationResult =
  | { ok: true; value: { relationId: string } }
  | { ok: false; error: ProductSupplierServiceError };

interface ProductSupplierRow {
  relationship_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_is_active: boolean;
  catalog_number: string | null;
  description: string | null;
  relationship_is_active: boolean;
}

interface ProductSupplierChoiceRow {
  supplier_id: string;
  supplier_name: string;
}

interface SupplierProductRow {
  relationship_id: string;
  product_id: string;
  product_serial_number: string;
  product_name: string;
  product_is_active: boolean;
  catalog_number: string | null;
  description: string | null;
  relationship_is_active: boolean;
}

interface ProductSupplierProductChoiceRow {
  product_id: string;
  product_serial_number: string;
  product_name: string;
}

function isProductSupplierRow(value: unknown): value is ProductSupplierRow {
  if (typeof value !== "object" || value === null) return false;

  return (
    "relationship_id" in value &&
    typeof value.relationship_id === "string" &&
    value.relationship_id.length > 0 &&
    "supplier_id" in value &&
    typeof value.supplier_id === "string" &&
    value.supplier_id.length > 0 &&
    "supplier_name" in value &&
    typeof value.supplier_name === "string" &&
    value.supplier_name.length > 0 &&
    "supplier_is_active" in value &&
    typeof value.supplier_is_active === "boolean" &&
    "catalog_number" in value &&
    (value.catalog_number === null ||
      typeof value.catalog_number === "string") &&
    "description" in value &&
    (value.description === null || typeof value.description === "string") &&
    "relationship_is_active" in value &&
    typeof value.relationship_is_active === "boolean"
  );
}

function isProductSupplierChoiceRow(
  value: unknown,
): value is ProductSupplierChoiceRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "supplier_id" in value &&
    typeof value.supplier_id === "string" &&
    value.supplier_id.length > 0 &&
    "supplier_name" in value &&
    typeof value.supplier_name === "string" &&
    value.supplier_name.length > 0
  );
}

function isSupplierProductRow(value: unknown): value is SupplierProductRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "relationship_id" in value &&
    typeof value.relationship_id === "string" &&
    value.relationship_id.length > 0 &&
    "product_id" in value &&
    typeof value.product_id === "string" &&
    value.product_id.length > 0 &&
    "product_serial_number" in value &&
    typeof value.product_serial_number === "string" &&
    /^(?:[0-9]{3}|[0-9]{7})$/.test(value.product_serial_number) &&
    "product_name" in value &&
    typeof value.product_name === "string" &&
    value.product_name.length > 0 &&
    "product_is_active" in value &&
    typeof value.product_is_active === "boolean" &&
    "catalog_number" in value &&
    (value.catalog_number === null ||
      typeof value.catalog_number === "string") &&
    "description" in value &&
    (value.description === null || typeof value.description === "string") &&
    "relationship_is_active" in value &&
    typeof value.relationship_is_active === "boolean"
  );
}

function isProductSupplierProductChoiceRow(
  value: unknown,
): value is ProductSupplierProductChoiceRow {
  return (
    typeof value === "object" &&
    value !== null &&
    "product_id" in value &&
    typeof value.product_id === "string" &&
    value.product_id.length > 0 &&
    "product_serial_number" in value &&
    typeof value.product_serial_number === "string" &&
    /^(?:[0-9]{3}|[0-9]{7})$/.test(value.product_serial_number) &&
    "product_name" in value &&
    typeof value.product_name === "string" &&
    value.product_name.length > 0
  );
}

function mapProductSupplier(
  row: ProductSupplierRow,
): ProductSupplierRelation {
  return {
    relationId: row.relationship_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    catalogNumber: row.catalog_number,
    description: row.description,
    isActive: row.relationship_is_active,
    supplierIsActive: row.supplier_is_active,
  };
}

function compareProductSuppliers(
  left: ProductSupplierRelation,
  right: ProductSupplierRelation,
): number {
  if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;

  const supplierComparison = left.supplierName.localeCompare(
    right.supplierName,
    undefined,
    { sensitivity: "base" },
  );
  if (supplierComparison) return supplierComparison;

  const catalogComparison = (left.catalogNumber ?? "").localeCompare(
    right.catalogNumber ?? "",
  );
  return catalogComparison || left.relationId.localeCompare(right.relationId);
}

function mapSupplierProduct(row: SupplierProductRow): SupplierProductRelation {
  return {
    relationId: row.relationship_id,
    productId: row.product_id,
    productSerialNumber: row.product_serial_number,
    productName: row.product_name,
    productIsActive: row.product_is_active,
    catalogNumber: row.catalog_number,
    description: row.description,
    isActive: row.relationship_is_active,
  };
}

function compareSupplierProducts(
  left: SupplierProductRelation,
  right: SupplierProductRelation,
): number {
  if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;

  const serialComparison = left.productSerialNumber.localeCompare(
    right.productSerialNumber,
  );
  if (serialComparison) return serialComparison;

  const catalogComparison = (left.catalogNumber ?? "").localeCompare(
    right.catalogNumber ?? "",
  );
  return catalogComparison || left.relationId.localeCompare(right.relationId);
}

function listFailure(): ProductSupplierListResult {
  return {
    ok: false,
    error: {
      code: "relationship_list_failed",
      message: "The Supplier links could not be loaded.",
    },
  };
}

function supplierChoiceListFailure(): ProductSupplierChoiceListResult {
  return {
    ok: false,
    error: {
      code: "supplier_choice_list_failed",
      message: "The active Supplier choices could not be loaded.",
    },
  };
}

function productLinkListFailure(): SupplierProductListResult {
  return {
    ok: false,
    error: {
      code: "product_link_list_failed",
      message: "The Product links could not be loaded.",
    },
  };
}

function productChoiceListFailure(): ProductSupplierProductChoiceListResult {
  return {
    ok: false,
    error: {
      code: "product_choice_list_failed",
      message: "The active Product choices could not be loaded.",
    },
  };
}

function mutationFailure(
  operation: "create" | "archive",
  providerCode?: string,
): ProductSupplierMutationResult {
  if (providerCode === "42501") {
    return {
      ok: false,
      error: {
        code: "access_denied",
        message: "You do not have permission to manage Supplier links.",
      },
    };
  }

  if (providerCode === "PSR02") {
    return {
      ok: false,
      error: {
        code: "product_unavailable",
        message: "This Product is unavailable for new Supplier links.",
      },
    };
  }

  if (providerCode === "PSR03") {
    return {
      ok: false,
      error: {
        code: "supplier_unavailable",
        message: "The selected Supplier is unavailable.",
      },
    };
  }

  if (providerCode === "PSR04") {
    return {
      ok: false,
      error: {
        code: "relationship_duplicate",
        message: "This Product and Supplier link already exists.",
      },
    };
  }

  if (providerCode === "PSR01") {
    return {
      ok: false,
      error: {
        code: "relationship_archived",
        message: "Archived Supplier links cannot be changed.",
      },
    };
  }

  if (providerCode === "22023") {
    return {
      ok: false,
      error: {
        code: "relationship_create_failed",
        message: "Select a valid Product and Supplier.",
      },
    };
  }

  if (providerCode === "P0002") {
    return {
      ok: false,
      error: {
        code: "relationship_not_found",
        message: "The Supplier link could not be found.",
      },
    };
  }

  const fallback = {
    create: {
      code: "relationship_create_failed" as const,
      message: "The Supplier link could not be added. Please try again.",
    },
    archive: {
      code: "relationship_archive_failed" as const,
      message: "The Supplier link could not be archived. Please try again.",
    },
  }[operation];

  return { ok: false, error: fallback };
}

export async function listProductSuppliers(
  productId: string,
): Promise<ProductSupplierListResult> {
  try {
    const { data, error } = await supabase.rpc(
      "get_product_suppliers_for_product",
      { p_product_id: productId },
    );

    if (error || !Array.isArray(data)) {
      return listFailure();
    }

    const relations: ProductSupplierRelation[] = [];
    for (const row of data) {
      if (!isProductSupplierRow(row)) return listFailure();
      relations.push(mapProductSupplier(row));
    }

    return {
      ok: true,
      value: relations.sort(compareProductSuppliers),
    };
  } catch {
    return listFailure();
  }
}

export async function listActiveSupplierChoices(): Promise<
  ProductSupplierChoiceListResult
> {
  try {
    const { data, error } = await supabase.rpc(
      "list_active_supplier_choices_for_product_supplier",
    );

    if (error || !Array.isArray(data)) return supplierChoiceListFailure();

    const choices: ProductSupplierChoice[] = [];
    for (const row of data) {
      if (!isProductSupplierChoiceRow(row)) {
        return supplierChoiceListFailure();
      }

      choices.push({
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
      });
    }

    return { ok: true, value: choices };
  } catch {
    return supplierChoiceListFailure();
  }
}

export async function listSupplierProducts(
  supplierId: string,
): Promise<SupplierProductListResult> {
  try {
    const { data, error } = await supabase.rpc(
      "get_product_suppliers_for_supplier",
      { p_supplier_id: supplierId },
    );

    if (error || !Array.isArray(data)) return productLinkListFailure();

    const relations: SupplierProductRelation[] = [];
    for (const row of data) {
      if (!isSupplierProductRow(row)) return productLinkListFailure();
      relations.push(mapSupplierProduct(row));
    }

    return {
      ok: true,
      value: relations.sort(compareSupplierProducts),
    };
  } catch {
    return productLinkListFailure();
  }
}

export async function listActiveProductChoices(): Promise<
  ProductSupplierProductChoiceListResult
> {
  try {
    const { data, error } = await supabase.rpc(
      "list_active_product_choices_for_product_supplier",
    );

    if (error || !Array.isArray(data)) return productChoiceListFailure();

    const choices: ProductSupplierProductChoice[] = [];
    for (const row of data) {
      if (!isProductSupplierProductChoiceRow(row)) {
        return productChoiceListFailure();
      }

      choices.push({
        productId: row.product_id,
        serialNumber: row.product_serial_number,
        productName: row.product_name,
      });
    }

    return { ok: true, value: choices };
  } catch {
    return productChoiceListFailure();
  }
}

export async function createProductSupplier(
  input: CreateProductSupplierInput,
): Promise<ProductSupplierMutationResult> {
  try {
    const { data, error } = await supabase.rpc("create_product_supplier", {
      p_product_id: input.productId,
      p_supplier_id: input.supplierId,
    });

    if (error) return mutationFailure("create", error.code);
    if (typeof data !== "string" || data.length === 0) {
      return mutationFailure("create");
    }

    return { ok: true, value: { relationId: data } };
  } catch {
    return mutationFailure("create");
  }
}

export async function archiveProductSupplier(
  relationId: string,
): Promise<ProductSupplierMutationResult> {
  try {
    const { data, error } = await supabase.rpc("archive_product_supplier", {
      p_product_supplier_id: relationId,
    });

    if (error) return mutationFailure("archive", error.code);
    if (typeof data !== "string" || data.length === 0) {
      return mutationFailure("archive");
    }

    return { ok: true, value: { relationId: data } };
  } catch {
    return mutationFailure("archive");
  }
}
