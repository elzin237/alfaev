import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  download: vi.fn(),
}));

vi.mock("./documentationPdfService", () => ({
  fetchDocumentationPdf: mocks.fetch,
  downloadPdfBlob: mocks.download,
}));

import DocumentationPdfViewerDialog from "./DocumentationPdfViewerDialog";
import type { DocumentationRecord } from "./documentationService";

const record: DocumentationRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Import invoice",
  category: "uvoz",
  documentDate: "2026-10-08",
  amount: "100",
  pdfStoragePath: "private/record.pdf",
  isActive: true,
  createdAt: "2026-10-08T08:00:00Z",
  updatedAt: "2026-10-08T08:00:00Z",
  archivedAt: null,
};

const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetch.mockResolvedValue({ ok: true, value: pdf });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn().mockReturnValue("blob:private-document-pdf"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
});

describe("DocumentationPdfViewerDialog", () => {
  it("loads the private PDF into an in-app no-referrer viewer without a popup", async () => {
    let resolveFetch: ((value: { ok: true; value: Blob }) => void) | undefined;
    mocks.fetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const openSpy = vi.spyOn(window, "open");

    render(<DocumentationPdfViewerDialog record={record} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Document PDF" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Preparing document PDF...")).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(record.id, "open");
    resolveFetch?.({ ok: true, value: pdf });

    const frame = await screen.findByTitle("Import invoice PDF");
    expect(frame).toHaveAttribute("src", "blob:private-document-pdf");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/does not appear in your browser/i)).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it("closes with Escape, revokes the URL, and restores focus", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open PDF";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const view = render(<DocumentationPdfViewerDialog record={record} onClose={onClose} />);
    await screen.findByTitle("Import invoice PDF");

    expect(screen.getByRole("button", { name: "Close PDF viewer" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-document-pdf");
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("contains keyboard focus and offers an explicit secure download fallback", async () => {
    render(<DocumentationPdfViewerDialog record={record} onClose={vi.fn()} />);
    await screen.findByTitle("Import invoice PDF");
    const close = screen.getByRole("button", { name: "Close PDF viewer" });
    const download = screen.getByRole("button", { name: "Download PDF" });

    download.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.click(download);
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(pdf, record.id);
  });

  it("shows safe retryable access errors and never exposes popup guidance", async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: false, error: "PDF could not be loaded. Please try again." })
      .mockResolvedValueOnce({ ok: true, value: pdf });
    render(<DocumentationPdfViewerDialog record={record} onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("PDF could not be loaded. Please try again.");
    expect(screen.queryByText(/popup|enable popups|allow popups/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTitle("Import invoice PDF")).toHaveAttribute(
      "src",
      "blob:private-document-pdf",
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a late access response after close without creating a URL", async () => {
    let resolveFetch: ((value: { ok: true; value: Blob }) => void) | undefined;
    mocks.fetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const view = render(<DocumentationPdfViewerDialog record={record} onClose={vi.fn()} />);
    view.unmount();
    resolveFetch?.({ ok: true, value: pdf });

    await waitFor(() => expect(URL.createObjectURL).not.toHaveBeenCalled());
  });
});
