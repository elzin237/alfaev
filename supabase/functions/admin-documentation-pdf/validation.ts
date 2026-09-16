export const documentationPdfBucket = "documentation-pdfs";
export const maxPdfBytes = 10 * 1024 * 1024;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PdfAction = "upload" | "open" | "download" | "remove";

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function isPdfAction(value: unknown): value is PdfAction {
  return value === "upload" || value === "open" || value === "download" || value === "remove";
}

export function generatedPdfPath(recordId: string, objectId: string): string {
  if (!isRecordId(recordId) || !isRecordId(objectId)) {
    throw new Error("Invalid generated PDF identity");
  }
  return `${recordId}/${objectId}.pdf`;
}

export async function isValidPdf(file: File): Promise<boolean> {
  if (file.type !== "application/pdf" || file.size < 20 || file.size > maxPdfBytes) {
    return false;
  }
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  if (!signature.every((byte, index) => header[index] === byte)) {
    return false;
  }
  const trailer = await file.slice(Math.max(0, file.size - 1024)).text();
  return trailer.includes("%%EOF");
}
