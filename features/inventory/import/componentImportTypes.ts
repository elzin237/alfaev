export const MAX_COMPONENT_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_COMPONENT_IMPORT_ROWS = 1000;
export const COMPONENT_IMPORT_HEADERS = ["Name", "Category", "Brand"] as const;
export const COMPONENT_IMPORT_SHEET_NAME = "Components";

export interface ComponentImportBrand {
  name: string;
  isActive: boolean;
}

export interface ComponentImportSubmissionRow {
  name: string;
  category: string;
  brand: string | null;
}

export type ComponentImportRowErrorCode =
  | "name_required"
  | "name_invalid_type"
  | "category_required"
  | "category_invalid_type"
  | "brand_invalid_type"
  | "brand_not_found"
  | "brand_archived"
  | "formula_not_allowed"
  | "extra_column";

export type ComponentImportField = "name" | "category" | "brand" | "row";

export interface ComponentImportRowError {
  code: ComponentImportRowErrorCode;
  field: ComponentImportField;
  message: string;
}

export interface ComponentImportPreviewRow {
  rowNumber: number;
  name: string;
  category: string;
  brand: string | null;
  status: "ready" | "invalid";
  errors: ComponentImportRowError[];
}

export interface ComponentImportPreview {
  rows: ComponentImportPreviewRow[];
  totalRows: number;
  readyRows: number;
  invalidRows: number;
  canImport: boolean;
  submissionRows: ComponentImportSubmissionRow[] | null;
}

export type ComponentImportFileErrorCode =
  | "unsupported_file_type"
  | "file_too_large"
  | "workbook_unreadable"
  | "invalid_sheet_count"
  | "invalid_headers"
  | "empty_workbook"
  | "too_many_rows";

export interface ComponentImportFileError {
  code: ComponentImportFileErrorCode;
  message: string;
}

export type ComponentImportParseResult =
  | { ok: true; preview: ComponentImportPreview }
  | { ok: false; error: ComponentImportFileError };

export interface ComponentImportFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ComponentImportCell =
  | { kind: "blank" }
  | { kind: "formula" }
  | { kind: "string"; value: string }
  | { kind: "other" };

export interface ComponentImportRawRow {
  rowNumber: number;
  cells: [ComponentImportCell, ComponentImportCell, ComponentImportCell];
  hasExtraColumn: boolean;
}
