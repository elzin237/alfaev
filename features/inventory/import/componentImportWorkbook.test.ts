import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";

import {
  COMPONENT_IMPORT_HEADERS,
  COMPONENT_IMPORT_SHEET_NAME,
  MAX_COMPONENT_IMPORT_FILE_BYTES,
  MAX_COMPONENT_IMPORT_ROWS,
  type ComponentImportBrand,
  type ComponentImportFile,
} from "./componentImportTypes";
import { createComponentImportTemplate } from "./componentImportTemplate";
import { parseComponentImportWorkbook } from "./componentImportWorkbook";

const brands: ComponentImportBrand[] = [
  { name: "Omron", isActive: true },
  { name: "Archived Bosch", isActive: false },
];

type CellValue = string | number | boolean | Date | null | XLSX.CellObject;

function workbookBytes(
  rows: CellValue[][],
  options: {
    secondSheet?: boolean;
    sheetName?: string;
    mutateWorksheet?: (worksheet: XLSX.WorkSheet) => void;
  } = {},
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  options.mutateWorksheet?.(worksheet);
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    options.sheetName ?? COMPONENT_IMPORT_SHEET_NAME,
  );
  if (options.secondSheet) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Other"]]),
      "Other",
    );
  }
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

function importFile(
  bytes: Uint8Array,
  name = "components.xlsx",
  size = bytes.byteLength,
): ComponentImportFile {
  return {
    name,
    size,
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
  };
}

function canonicalWorkbook(...rows: CellValue[][]): Uint8Array {
  return workbookBytes([[...COMPONENT_IMPORT_HEADERS], ...rows]);
}

function formula(formulaText = "1+1"): XLSX.CellObject {
  return { t: "n", f: formulaText, v: 2 };
}

describe("Component import workbook parsing", () => {
  it("parses a canonical workbook and accepts uppercase .XLSX", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(["Resistor", "Passive", "Omron"]), "PARTS.XLSX"),
      brands,
    );

    expect(result).toEqual({
      ok: true,
      preview: {
        rows: [{
          rowNumber: 2,
          name: "Resistor",
          category: "Passive",
          brand: "Omron",
          status: "ready",
          errors: [],
        }],
        totalRows: 1,
        readyRows: 1,
        invalidRows: 0,
        canImport: true,
        submissionRows: [{ name: "Resistor", category: "Passive", brand: "Omron" }],
      },
    });
  });

  it.each(["parts.xls", "parts.xlsm", "parts.csv", "parts.txt"])(
    "rejects unsupported file type %s",
    async (name) => {
      const result = await parseComponentImportWorkbook(
        importFile(canonicalWorkbook(["R", "C", null]), name),
        brands,
      );
      expect(result).toMatchObject({ ok: false, error: { code: "unsupported_file_type" } });
    },
  );

  it("rejects an oversized file before reading its bytes", async () => {
    const arrayBuffer = vi.fn<() => Promise<ArrayBuffer>>();
    const result = await parseComponentImportWorkbook({
      name: "large.xlsx",
      size: MAX_COMPONENT_IMPORT_FILE_BYTES + 1,
      arrayBuffer,
    }, brands);

    expect(result).toMatchObject({ ok: false, error: { code: "file_too_large" } });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects oversized actual bytes before parsing when reported size is inaccurate", async () => {
    const bytes = new ArrayBuffer(MAX_COMPONENT_IMPORT_FILE_BYTES + 1);
    const result = await parseComponentImportWorkbook({
      name: "misreported.xlsx",
      size: 1,
      async arrayBuffer() {
        return bytes;
      },
    }, brands);

    expect(result).toMatchObject({ ok: false, error: { code: "file_too_large" } });
  });

  it("maps corrupt input to a safe unreadable-workbook error", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(new Uint8Array([1, 2, 3, 4])),
      brands,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "workbook_unreadable", message: "The workbook could not be read." },
    });
  });

  it("requires exactly one worksheet without relying on its name", async () => {
    const accepted = await parseComponentImportWorkbook(
      importFile(workbookBytes([
        [...COMPONENT_IMPORT_HEADERS], ["R", "C", null],
      ], { sheetName: "Anything" })),
      brands,
    );
    const rejected = await parseComponentImportWorkbook(
      importFile(workbookBytes([
        [...COMPONENT_IMPORT_HEADERS], ["R", "C", null],
      ], { secondSheet: true })),
      brands,
    );

    expect(accepted.ok).toBe(true);
    expect(rejected).toMatchObject({ ok: false, error: { code: "invalid_sheet_count" } });
  });

  it.each([
    [["Category", "Name", "Brand"], "wrong order"],
    [["Name", "Category"], "missing Brand"],
    [["Product", "Category", "Brand"], "renamed header"],
    [["Name", "Category", "Name"], "duplicate header"],
    [["Name", "Category", "Brand", "Extra"], "extra header"],
  ] as const)("rejects invalid headers: %s", async (headers, _description) => {
    const result = await parseComponentImportWorkbook(
      importFile(workbookBytes([headers as unknown as CellValue[], ["R", "C", null]])),
      brands,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_headers" } });
  });

  it("trims canonical header strings before exact comparison", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(workbookBytes([
        [" Name ", " Category ", " Brand "],
        ["R", "Parts", null],
      ])),
      brands,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects formula headers", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(workbookBytes([[formula(), "Category", "Brand"], ["R", "C", null]])),
      brands,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_headers" } });
  });

  it("normalizes whitespace and resolves Brands case-insensitively to canonical names", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(
        ["  Relay  ", "  Control  ", "  OMRON  "],
        ["No Brand", "Parts", "   "],
        ["Null Brand", "Parts", null],
      )),
      brands,
    );
    expect(result.ok && result.preview.submissionRows).toEqual([
      { name: "Relay", category: "Control", brand: "Omron" },
      { name: "No Brand", category: "Parts", brand: null },
      { name: "Null Brand", category: "Parts", brand: null },
    ]);
  });

  it("keeps unknown and archived Brand rows invalid", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(
        ["Unknown", "Parts", "Missing Brand"],
        ["Archived", "Parts", "archived bosch"],
      )),
      brands,
    );
    expect(result.ok && result.preview.rows.map((row) => row.errors.map((error) => error.code)))
      .toEqual([["brand_not_found"], ["brand_archived"]]);
    expect(result.ok && result.preview).toMatchObject({
      totalRows: 2, readyRows: 0, invalidRows: 2, canImport: false, submissionRows: null,
    });
  });

  it.each([
    [[" ", "Parts", null], "name_required"],
    [["R", " ", null], "category_required"],
    [[42, "Parts", null], "name_invalid_type"],
    [["R", 42, null], "category_invalid_type"],
    [["R", "Parts", 42], "brand_invalid_type"],
    [[true, "Parts", null], "name_invalid_type"],
    [["R", false, null], "category_invalid_type"],
    [["R", "Parts", new Date("2026-01-01T00:00:00Z")], "brand_invalid_type"],
    [["R", "Parts", { t: "e", v: 0 }], "brand_invalid_type"],
  ] as const)("reports typed cell validation for %s", async (row, code) => {
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(row as unknown as CellValue[])),
      brands,
    );
    expect(result.ok && result.preview.rows[0]?.errors.map((error) => error.code))
      .toContain(code);
  });

  it.each([0, 1, 2] as const)("rejects a formula in data column %s", async (column) => {
    const row: CellValue[] = ["R", "Parts", "Omron"];
    row[column] = formula();
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(row)),
      brands,
    );
    expect(result.ok && result.preview.rows[0]?.errors.map((error) => error.code))
      .toContain("formula_not_allowed");
  });

  it("rejects array-formula range metadata carried only by F", async () => {
    const bytes = workbookBytes([
      [...COMPONENT_IMPORT_HEADERS],
      ["First", "Parts", null],
      ["Second", "Parts", null],
    ], {
      mutateWorksheet(worksheet) {
        XLSX.utils.sheet_set_array_formula(worksheet, "A2:A3", "1+1");
        worksheet.A3!.v = 2;
        expect(worksheet.A3?.F).toBe("A2:A3");
        expect(worksheet.A3?.f).toBeUndefined();
      },
    });
    const result = await parseComponentImportWorkbook(importFile(bytes), brands);

    expect(result.ok && result.preview.rows[1]?.errors.map((error) => error.code))
      .toContain("formula_not_allowed");
  });

  it("keeps partially populated rows invalid, ignores blank rows, and preserves physical row numbers", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(
        ["First", "Parts", null],
        [null, null, null],
        ["Partial", null, null],
        [null, null, null],
        ["Last", "Parts", null],
      )),
      brands,
    );
    expect(result.ok && result.preview.rows.map((row) => ({
      rowNumber: row.rowNumber, status: row.status,
    }))).toEqual([
      { rowNumber: 2, status: "ready" },
      { rowNumber: 4, status: "invalid" },
      { rowNumber: 6, status: "ready" },
    ]);
    expect(result.ok && result.preview).toMatchObject({
      totalRows: 3, readyRows: 2, invalidRows: 1, canImport: false, submissionRows: null,
    });
  });

  it("reports an unexpected data column as a row-level error", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(["R", "Parts", null, "Forbidden"])),
      brands,
    );
    expect(result.ok && result.preview.rows[0]?.errors).toContainEqual({
      code: "extra_column",
      field: "row",
      message: "Only Name, Category, and Brand columns are allowed.",
    });
  });

  it("rejects headers-only and physically empty workbooks", async () => {
    const headersOnly = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook()),
      brands,
    );
    const empty = await parseComponentImportWorkbook(
      importFile(workbookBytes([])),
      brands,
    );
    expect(headersOnly).toEqual({
      ok: false,
      error: {
        code: "empty_workbook",
        message: "No Components found. Add Component rows below the Name, Category, and Brand headers, save the Excel file, then upload it again.",
      },
    });
    expect(empty).toMatchObject({ ok: false, error: { code: "invalid_headers" } });
  });

  it("accepts 1000 rows and rejects 1001 without truncating", async () => {
    const allowedRows = Array.from({ length: MAX_COMPONENT_IMPORT_ROWS }, (_, index) => [
      `Part ${index}`, "Parts", null,
    ] satisfies CellValue[]);
    const allowed = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(...allowedRows)),
      brands,
    );
    const rejected = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(...allowedRows, ["Overflow", "Parts", null])),
      brands,
    );
    expect(allowed.ok && allowed.preview).toMatchObject({
      totalRows: 1000, readyRows: 1000, invalidRows: 0, canImport: true,
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: "too_many_rows" } });
  });

  it("counts retained rows rather than sparse physical row positions", async () => {
    const bytes = workbookBytes([
      [...COMPONENT_IMPORT_HEADERS],
      ["First", "Parts", null],
    ], {
      mutateWorksheet(worksheet) {
        worksheet.A1501 = { t: "s", v: "Last" };
        worksheet.B1501 = { t: "s", v: "Parts" };
        worksheet["!ref"] = "A1:C1501";
      },
    });
    const result = await parseComponentImportWorkbook(importFile(bytes), brands);

    expect(result.ok && result.preview.rows.map((row) => row.rowNumber)).toEqual([2, 1501]);
    expect(result.ok && result.preview).toMatchObject({
      totalRows: 2,
      readyRows: 2,
      invalidRows: 0,
      canImport: true,
    });
  });

  it("preserves duplicate-looking rows and submission order", async () => {
    const result = await parseComponentImportWorkbook(
      importFile(canonicalWorkbook(
        ["Same", "Parts", null],
        ["Same", "Parts", null],
        ["Different", "Parts", "Omron"],
      )),
      brands,
    );
    expect(result.ok && result.preview.submissionRows).toEqual([
      { name: "Same", category: "Parts", brand: null },
      { name: "Same", category: "Parts", brand: null },
      { name: "Different", category: "Parts", brand: "Omron" },
    ]);
  });
});

describe("Component import template", () => {
  it("generates one Components worksheet with only canonical headers", async () => {
    const bytes = createComponentImportTemplate();
    const workbook = XLSX.read(bytes, { type: "array", raw: true });
    expect(workbook.SheetNames).toEqual([COMPONENT_IMPORT_SHEET_NAME]);
    const worksheet = workbook.Sheets[COMPONENT_IMPORT_SHEET_NAME];
    expect(worksheet).toBeDefined();
    expect(XLSX.utils.sheet_to_json(worksheet!, { header: 1, raw: true }))
      .toEqual([[...COMPONENT_IMPORT_HEADERS]]);

    const parsed = await parseComponentImportWorkbook(
      importFile(bytes, "template.xlsx"),
      brands,
    );
    expect(parsed).toMatchObject({ ok: false, error: { code: "empty_workbook" } });
  });
});
