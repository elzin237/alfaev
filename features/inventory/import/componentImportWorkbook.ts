import * as XLSX from "xlsx";

import {
  COMPONENT_IMPORT_HEADERS,
  MAX_COMPONENT_IMPORT_FILE_BYTES,
  MAX_COMPONENT_IMPORT_ROWS,
  type ComponentImportBrand,
  type ComponentImportCell,
  type ComponentImportFile,
  type ComponentImportFileError,
  type ComponentImportParseResult,
  type ComponentImportRawRow,
} from "./componentImportTypes";
import { buildComponentImportPreview } from "./componentImportValidation";

const readOptions: XLSX.ParsingOptions = {
  type: "array",
  sheets: 0,
  raw: true,
  cellFormula: true,
  cellHTML: false,
  cellStyles: false,
  cellText: false,
  cellDates: true,
  bookDeps: false,
  bookFiles: false,
  bookProps: false,
  bookVBA: false,
};

function failure(
  code: ComponentImportFileError["code"],
  message: string,
): ComponentImportParseResult {
  return { ok: false, error: { code, message } };
}

function isSupportedFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".xlsx");
}

function hasXlsxContainerSignature(bytes: ArrayBuffer): boolean {
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  return signature.length === 4 && signature[0] === 0x50 && signature[1] === 0x4b &&
    signature[2] === 0x03 && signature[3] === 0x04;
}

function getCell(worksheet: XLSX.WorkSheet, row: number, column: number): XLSX.CellObject | undefined {
  return worksheet[XLSX.utils.encode_cell({ r: row, c: column })] as
    XLSX.CellObject | undefined;
}

function isFormulaCell(cell: XLSX.CellObject | undefined): boolean {
  return (typeof cell?.f === "string" && cell.f.length > 0) ||
    (typeof cell?.F === "string" && cell.F.length > 0);
}

function isPresentCell(cell: XLSX.CellObject | undefined): boolean {
  if (!cell) return false;
  if (isFormulaCell(cell)) return true;
  return cell.t !== "z" && cell.v !== undefined && cell.v !== null && cell.v !== "";
}

function toImportCell(cell: XLSX.CellObject | undefined): ComponentImportCell {
  if (!isPresentCell(cell)) return { kind: "blank" };
  if (isFormulaCell(cell)) return { kind: "formula" };
  if (cell?.t === "s" && typeof cell.v === "string") {
    return { kind: "string", value: cell.v };
  }
  return { kind: "other" };
}

interface PresentWorksheetCell {
  row: number;
  column: number;
  cell: XLSX.CellObject;
}

function getPresentWorksheetCells(worksheet: XLSX.WorkSheet): PresentWorksheetCell[] {
  const cells: PresentWorksheetCell[] = [];
  for (const address of Object.keys(worksheet)) {
    if (!/^[A-Z]+[1-9][0-9]*$/.test(address)) continue;
    const cell = worksheet[address] as XLSX.CellObject | undefined;
    if (!cell || !isPresentCell(cell)) continue;
    const decoded = XLSX.utils.decode_cell(address);
    cells.push({ row: decoded.r, column: decoded.c, cell });
  }
  return cells;
}

function headersAreCanonical(
  worksheet: XLSX.WorkSheet,
  presentCells: readonly PresentWorksheetCell[],
): boolean {
  if (presentCells.some(({ row, column }) =>
    row === 0 && column >= COMPONENT_IMPORT_HEADERS.length
  )) return false;
  return COMPONENT_IMPORT_HEADERS.every((expected, column) => {
    const cell = getCell(worksheet, 0, column);
    return !isFormulaCell(cell) && cell?.t === "s" &&
      typeof cell.v === "string" && cell.v.trim() === expected;
  });
}

function extractRows(
  presentCells: readonly PresentWorksheetCell[],
): ComponentImportRawRow[] | undefined {
  const cellsByRow = new Map<number, Map<number, XLSX.CellObject>>();
  for (const { row, column, cell } of presentCells) {
    if (row === 0) continue;
    let rowCells = cellsByRow.get(row);
    if (!rowCells) {
      if (cellsByRow.size >= MAX_COMPONENT_IMPORT_ROWS) return undefined;
      rowCells = new Map<number, XLSX.CellObject>();
      cellsByRow.set(row, rowCells);
    }
    rowCells.set(column, cell);
  }

  return [...cellsByRow.entries()]
    .sort(([leftRow], [rightRow]) => leftRow - rightRow)
    .map(([row, rowCells]) => ({
      rowNumber: row + 1,
      cells: [
        toImportCell(rowCells.get(0)),
        toImportCell(rowCells.get(1)),
        toImportCell(rowCells.get(2)),
      ],
      hasExtraColumn: [...rowCells.keys()].some((column) =>
        column >= COMPONENT_IMPORT_HEADERS.length
      ),
    }));
}

export async function parseComponentImportWorkbook(
  file: ComponentImportFile,
  availableBrands: readonly ComponentImportBrand[],
): Promise<ComponentImportParseResult> {
  if (!isSupportedFilename(file.name)) {
    return failure("unsupported_file_type", "Choose an .xlsx workbook.");
  }
  if (file.size > MAX_COMPONENT_IMPORT_FILE_BYTES) {
    return failure("file_too_large", "The workbook must be 5 MiB or smaller.");
  }

  let workbook: XLSX.WorkBook;
  try {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_COMPONENT_IMPORT_FILE_BYTES) {
      return failure("file_too_large", "The workbook must be 5 MiB or smaller.");
    }
    if (!hasXlsxContainerSignature(bytes)) {
      return failure("workbook_unreadable", "The workbook could not be read.");
    }
    workbook = XLSX.read(bytes, readOptions);
  } catch {
    return failure("workbook_unreadable", "The workbook could not be read.");
  }

  if (workbook.SheetNames.length !== 1) {
    return failure("invalid_sheet_count", "The workbook must contain exactly one worksheet.");
  }
  const worksheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!worksheet) {
    return failure("workbook_unreadable", "The workbook could not be read.");
  }
  const presentCells = getPresentWorksheetCells(worksheet);
  if (!headersAreCanonical(worksheet, presentCells)) {
    return failure(
      "invalid_headers",
      "Row 1 must contain exactly Name, Category, and Brand in that order.",
    );
  }

  const rows = extractRows(presentCells);
  if (!rows) {
    return failure("too_many_rows", "A workbook can contain at most 1000 Component rows.");
  }
  if (rows.length === 0) {
    return failure("empty_workbook", "The workbook contains no Component rows.");
  }

  return { ok: true, preview: buildComponentImportPreview(rows, availableBrands) };
}
