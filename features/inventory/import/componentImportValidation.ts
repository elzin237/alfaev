import { productNameCategorySchema } from "../validation/productSchema";
import type {
  ComponentImportBrand,
  ComponentImportCell,
  ComponentImportField,
  ComponentImportPreview,
  ComponentImportPreviewRow,
  ComponentImportRawRow,
  ComponentImportRowError,
  ComponentImportRowErrorCode,
  ComponentImportSubmissionRow,
} from "./componentImportTypes";

const messages: Record<ComponentImportRowErrorCode, string> = {
  name_required: "Name is required.",
  name_invalid_type: "Name must be text.",
  category_required: "Category is required.",
  category_invalid_type: "Category must be text.",
  brand_invalid_type: "Brand must be text or blank.",
  brand_not_found: "Brand was not found.",
  brand_archived: "Brand is archived and cannot be selected.",
  formula_not_allowed: "Formulas are not allowed in import cells.",
  extra_column: "Only Name, Category, and Brand columns are allowed.",
};

function rowError(
  code: ComponentImportRowErrorCode,
  field: ComponentImportField,
): ComponentImportRowError {
  return { code, field, message: messages[code] };
}

function readRequiredText(
  cell: ComponentImportCell,
  field: "name" | "category",
  errors: ComponentImportRowError[],
): string {
  if (cell.kind === "formula") {
    errors.push(rowError("formula_not_allowed", field));
    return "";
  }
  if (cell.kind === "blank") {
    errors.push(rowError(`${field}_required`, field));
    return "";
  }
  if (cell.kind !== "string") {
    errors.push(rowError(`${field}_invalid_type`, field));
    return "";
  }

  const value = cell.value.trim();
  if (!value) errors.push(rowError(`${field}_required`, field));
  return value;
}

function buildBrandLookup(brands: readonly ComponentImportBrand[]) {
  const lookup = new Map<string, ComponentImportBrand>();
  for (const brand of brands) {
    const name = brand.name.trim();
    if (name) lookup.set(name.toLowerCase(), { ...brand, name });
  }
  return lookup;
}

function readBrand(
  cell: ComponentImportCell,
  brands: ReadonlyMap<string, ComponentImportBrand>,
  errors: ComponentImportRowError[],
): string | null {
  if (cell.kind === "formula") {
    errors.push(rowError("formula_not_allowed", "brand"));
    return null;
  }
  if (cell.kind === "blank") return null;
  if (cell.kind !== "string") {
    errors.push(rowError("brand_invalid_type", "brand"));
    return null;
  }

  const value = cell.value.trim();
  if (!value) return null;
  const brand = brands.get(value.toLowerCase());
  if (!brand) {
    errors.push(rowError("brand_not_found", "brand"));
    return value;
  }
  if (!brand.isActive) {
    errors.push(rowError("brand_archived", "brand"));
  }
  return brand.name;
}

export function buildComponentImportPreview(
  rawRows: readonly ComponentImportRawRow[],
  availableBrands: readonly ComponentImportBrand[],
): ComponentImportPreview {
  const brands = buildBrandLookup(availableBrands);
  const submissionRows: ComponentImportSubmissionRow[] = [];
  const rows: ComponentImportPreviewRow[] = rawRows.map((rawRow) => {
    const errors: ComponentImportRowError[] = [];
    const name = readRequiredText(rawRow.cells[0], "name", errors);
    const category = readRequiredText(rawRow.cells[1], "category", errors);
    const brand = readBrand(rawRow.cells[2], brands, errors);
    if (rawRow.hasExtraColumn) errors.push(rowError("extra_column", "row"));

    const normalized = productNameCategorySchema.safeParse({ name, category });
    if (!normalized.success) {
      for (const issue of normalized.error.issues) {
        const field = issue.path[0];
        if (field === "name" && !errors.some((error) => error.field === "name")) {
          errors.push(rowError("name_required", "name"));
        }
        if (field === "category" &&
          !errors.some((error) => error.field === "category")) {
          errors.push(rowError("category_required", "category"));
        }
      }
    }

    if (errors.length === 0) submissionRows.push({ name, category, brand });
    return {
      rowNumber: rawRow.rowNumber,
      name,
      category,
      brand,
      status: errors.length === 0 ? "ready" : "invalid",
      errors,
    };
  });

  const readyRows = rows.filter((row) => row.status === "ready").length;
  const invalidRows = rows.length - readyRows;
  const canImport = rows.length > 0 && invalidRows === 0;
  return {
    rows,
    totalRows: rows.length,
    readyRows,
    invalidRows,
    canImport,
    submissionRows: canImport ? submissionRows : null,
  };
}
