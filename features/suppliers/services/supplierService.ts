import { supabase } from "../../../lib/supabase/client";

interface SupplierRow {
  id: string;
  name: string;
  country: string;
  contact_person_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  country: string;
  contactPersonName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface SupplierCreateInput {
  name: string;
  country: string;
  contactPersonName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface SupplierServiceError {
  code:
    | "access_denied"
    | "supplier_duplicate"
    | "supplier_email_invalid"
    | "supplier_invalid"
    | "supplier_list_failed"
    | "supplier_create_failed";
  message: string;
}

export type SupplierListResult =
  | { ok: true; value: Supplier[] }
  | { ok: false; error: SupplierServiceError };

export type SupplierCreateResult =
  | { ok: true; value: { supplierId: string } }
  | { ok: false; error: SupplierServiceError };

function isSupplierRow(value: unknown): value is SupplierRow {
  if (typeof value !== "object" || value === null) return false;

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "country" in value &&
    typeof value.country === "string" &&
    "contact_person_name" in value &&
    (typeof value.contact_person_name === "string" ||
      value.contact_person_name === null) &&
    "contact_phone" in value &&
    (typeof value.contact_phone === "string" ||
      value.contact_phone === null) &&
    "contact_email" in value &&
    (typeof value.contact_email === "string" ||
      value.contact_email === null) &&
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

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    contactPersonName: row.contact_person_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function compareSuppliers(left: Supplier, right: Supplier): number {
  if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;

  const nameComparison = left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });

  return nameComparison || left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id);
}

function listFailure(): SupplierListResult {
  return {
    ok: false,
    error: {
      code: "supplier_list_failed",
      message: "The Supplier list could not be loaded.",
    },
  };
}

function createFailure(code?: string): SupplierCreateResult {
  switch (code) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "You do not have permission to create Suppliers.",
        },
      };
    case "SUP02":
      return {
        ok: false,
        error: {
          code: "supplier_duplicate",
          message: "A Supplier with this name already exists.",
        },
      };
    case "SUP03":
      return {
        ok: false,
        error: {
          code: "supplier_email_invalid",
          message: "Enter a valid Supplier email address.",
        },
      };
    case "22023":
      return {
        ok: false,
        error: {
          code: "supplier_invalid",
          message: "Enter valid required Supplier details.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "supplier_create_failed",
          message: "The Supplier could not be created. Please try again.",
        },
      };
  }
}

function normalizeOptional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export async function listSuppliers(): Promise<SupplierListResult> {
  try {
    const { data, error } = await supabase
      .from("suppliers")
      .select(
        "id,name,country,contact_person_name,contact_phone,contact_email,is_active,created_at,updated_at,archived_at",
      );

    if (error || !Array.isArray(data) || !data.every(isSupplierRow)) {
      return listFailure();
    }

    return {
      ok: true,
      value: data.map(mapSupplier).sort(compareSuppliers),
    };
  } catch {
    return listFailure();
  }
}

export async function createSupplier(
  input: SupplierCreateInput,
): Promise<SupplierCreateResult> {
  try {
    const contactEmail = normalizeOptional(input.contactEmail)?.toLowerCase() ??
      null;
    const { data, error } = await supabase.rpc("create_supplier", {
      p_name: input.name.trim(),
      p_country: input.country.trim(),
      p_contact_person_name: normalizeOptional(input.contactPersonName),
      p_contact_phone: normalizeOptional(input.contactPhone),
      p_contact_email: contactEmail,
    });

    if (error) return createFailure(error.code);
    if (typeof data !== "string") return createFailure();

    return { ok: true, value: { supplierId: data } };
  } catch {
    return createFailure();
  }
}
