import { supabase } from "../../lib/supabase/client";
import type { DocumentationResult } from "./documentationService";

export const MAX_DOCUMENT_PDF_BYTES = 10 * 1024 * 1024;

export function validatePdfFile(file: File): string | null {
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    return "Select a PDF file.";
  }
  if (file.size > MAX_DOCUMENT_PDF_BYTES) return "PDF must be 10 MiB or smaller.";
  return null;
}

export async function uploadDocumentationPdf(recordId: string, file: File): Promise<DocumentationResult<void>> {
  const issue = validatePdfFile(file);
  if (issue) return { ok: false, error: issue };
  const body = new FormData();
  body.append("action", "upload");
  body.append("recordId", recordId);
  body.append("file", file);
  const { data, error } = await supabase.functions.invoke("admin-documentation-pdf", { body });
  if (error || typeof data !== "object" || data === null || !("code" in data) ||
    (data.code !== "pdf_attached" && data.code !== "pdf_replaced")) {
    return { ok: false, error: "PDF could not be saved. Please try again." };
  }
  return { ok: true, value: undefined };
}

export async function removeDocumentationPdf(recordId: string): Promise<DocumentationResult<void>> {
  const { data, error } = await supabase.functions.invoke("admin-documentation-pdf", {
    body: { action: "remove", recordId },
  });
  if (error || typeof data !== "object" || data === null || !("code" in data) || data.code !== "pdf_removed") {
    return { ok: false, error: "PDF could not be removed. Please try again." };
  }
  return { ok: true, value: undefined };
}

export async function fetchDocumentationPdf(recordId: string, action: "open" | "download"): Promise<DocumentationResult<Blob>> {
  const { data, error } = await supabase.functions.invoke("admin-documentation-pdf", {
    body: { action, recordId },
  });
  if (error || !(data instanceof Blob) || data.type !== "application/pdf") {
    return { ok: false, error: "PDF could not be loaded. Please try again." };
  }
  return { ok: true, value: data };
}

export function openPdfBlob(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const windowRef = window.open(url, "_blank");
  if (!windowRef) {
    URL.revokeObjectURL(url);
    return false;
  }
  windowRef.opener = null;
  // Give the new tab time to load before releasing the temporary URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export function downloadPdfBlob(blob: Blob, recordId: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `alfaev-document-${recordId}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
