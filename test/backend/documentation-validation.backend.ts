import { describe, expect, it } from "vitest";

import {
  documentationPdfBucket,
  generatedPdfPath,
  isPdfAction,
  isRecordId,
  isValidPdf,
  maxPdfBytes,
} from "../../supabase/functions/admin-documentation-pdf/validation";

const recordId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";

function pdfFile(contents: string, type = "application/pdf", name = "anything.pdf") {
  return new File([contents], name, { type });
}

describe("Documentation PDF trust boundary", () => {
  it("uses only generated record-scoped PDF paths", () => {
    expect(documentationPdfBucket).toBe("documentation-pdfs");
    expect(generatedPdfPath(recordId, objectId)).toBe(`${recordId}/${objectId}.pdf`);
    expect(() => generatedPdfPath("../other", objectId)).toThrow();
    expect(() => generatedPdfPath(recordId, "user-file.pdf")).toThrow();
    expect(isRecordId(recordId)).toBe(true);
    expect(isPdfAction("upload")).toBe(true);
    expect(isPdfAction("delete_record")).toBe(false);
  });

  it("accepts a small PDF with an actual header and EOF marker", async () => {
    expect(await isValidPdf(pdfFile("%PDF-1.4\n1 0 obj\n%%EOF\n"))).toBe(true);
  });

  it("rejects fake extensions, wrong MIME, incomplete bytes, and oversize files", async () => {
    expect(await isValidPdf(pdfFile("not actually a PDF file%%EOF"))).toBe(false);
    expect(await isValidPdf(pdfFile("%PDF-1.4\n1 0 obj\n%%EOF\n", "text/plain"))).toBe(false);
    expect(await isValidPdf(pdfFile("%PDF-1.4\n1 0 obj\nno trailer"))).toBe(false);
    expect(await isValidPdf(new File([new Uint8Array(maxPdfBytes + 1)], "large.pdf", { type: "application/pdf" }))).toBe(false);
  });
});
