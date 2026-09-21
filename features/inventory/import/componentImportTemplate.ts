import * as XLSX from "xlsx";

import {
  COMPONENT_IMPORT_HEADERS,
  COMPONENT_IMPORT_SHEET_NAME,
} from "./componentImportTypes";

export function createComponentImportTemplate(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([[...COMPONENT_IMPORT_HEADERS]]);
  XLSX.utils.book_append_sheet(workbook, worksheet, COMPONENT_IMPORT_SHEET_NAME);
  return new Uint8Array(XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
    compression: true,
  }));
}
