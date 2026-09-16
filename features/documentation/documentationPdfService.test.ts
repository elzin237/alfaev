import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
import { downloadPdfBlob, fetchDocumentationPdf, openPdfBlob, removeDocumentationPdf, uploadDocumentationPdf, validatePdfFile } from "./documentationPdfService";

beforeEach(() => vi.resetAllMocks());

describe("Documentation private PDF client", () => {
  it("sends only action, recordId and file to Edge upload", async () => {
    mocks.invoke.mockResolvedValue({ data: { code: "pdf_attached" }, error: null });
    const file = new File(["%PDF-"], "test.pdf", { type: "application/pdf" });
    expect(await uploadDocumentationPdf("record-id", file)).toEqual({ ok: true, value: undefined });
    const options = mocks.invoke.mock.calls[0]?.[1];
    expect(options).toBeDefined();
    expect(options.body).toBeInstanceOf(FormData);
    expect([...options.body.keys()]).toEqual(["action", "recordId", "file"]);
    expect(options.body.get("file")).toBe(file);
  });

  it("uses Edge for open, download and remove", async () => {
    const pdf = new Blob(["%PDF-"], { type: "application/pdf" });
    mocks.invoke.mockResolvedValueOnce({ data: pdf, error: null })
      .mockResolvedValueOnce({ data: pdf, error: null })
      .mockResolvedValueOnce({ data: { code: "pdf_removed" }, error: null });
    expect((await fetchDocumentationPdf("id", "open")).ok).toBe(true);
    expect((await fetchDocumentationPdf("id", "download")).ok).toBe(true);
    expect((await removeDocumentationPdf("id")).ok).toBe(true);
    expect(mocks.invoke.mock.calls.map((call) => call[1].body)).toEqual([
      { action: "open", recordId: "id" }, { action: "download", recordId: "id" }, { action: "remove", recordId: "id" },
    ]);
  });

  it("rejects oversized and non-PDF files before Edge call", () => {
    expect(validatePdfFile(new File(["x"], "x.txt", { type: "text/plain" }))).not.toBeNull();
    expect(validatePdfFile(new File(["x"], "x.pdf", { type: "application/pdf" }))).toBeNull();
  });

  it("opens a temporary PDF URL, handles popup failure, and revokes it", () => {
    const pdf = new Blob(["%PDF-"], { type: "application/pdf" });
    const create = vi.fn().mockReturnValue("blob:test-pdf");
    const revoke = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    try {
      expect(openPdfBlob(pdf)).toBe(false);
      expect(open).toHaveBeenCalledWith("blob:test-pdf", "_blank");
      expect(revoke).toHaveBeenCalledWith("blob:test-pdf");
    } finally {
      open.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("downloads with deterministic filename and releases the URL", () => {
    vi.useFakeTimers();
    const create = vi.fn().mockReturnValue("blob:test-download");
    const revoke = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("alfaev-document-record-id.pdf");
      expect(this.href).toBe("blob:test-download");
    });
    try {
      downloadPdfBlob(new Blob(["%PDF-"], { type: "application/pdf" }), "record-id");
      expect(click).toHaveBeenCalledOnce();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith("blob:test-download");
    } finally {
      click.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      vi.useRealTimers();
    }
  });
});
