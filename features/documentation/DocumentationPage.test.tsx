import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(), invalidateQueries: vi.fn(), refetch: vi.fn(),
  list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), fetch: vi.fn(), useAuth: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("./documentationService", async (importOriginal) => ({
  ...await importOriginal<typeof import("./documentationService")>(),
  listDocumentationRecords: mocks.list,
  createDocumentationRecord: mocks.create,
  updateDocumentationRecord: mocks.update,
  archiveDocumentationRecord: mocks.archive,
}));
vi.mock("./documentationPdfService", async (importOriginal) => ({
  ...await importOriginal<typeof import("./documentationPdfService")>(),
  uploadDocumentationPdf: mocks.upload,
  removeDocumentationPdf: mocks.remove,
  fetchDocumentationPdf: mocks.fetch,
}));

import DocumentationPage from "./DocumentationPage";
import type { DocumentationRecord } from "./documentationService";

const active: DocumentationRecord = {
  id: "00000000-0000-0000-0000-000000000001", name: "Import invoice", category: "uvoz",
  documentDate: "2026-09-16", amount: "12345678901234567890.123456789",
  pdfStoragePath: "private-path", isActive: true,
  createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z", archivedAt: null,
};
const archived: DocumentationRecord = { ...active, id: "00000000-0000-0000-0000-000000000002",
  name: "Old export", category: "izvoz", isActive: false,
  archivedAt: "2026-09-16T00:00:00Z" };

function setRows(rows: DocumentationRecord[]) {
  mocks.useQuery.mockReturnValue({ isPending: false, isError: false,
    data: { ok: true, value: rows }, refetch: mocks.refetch });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.useAuth.mockReturnValue({ profile: { id: "admin-profile" }, isAdmin: true });
  mocks.invalidateQueries.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ ok: true, value: "00000000-0000-0000-0000-000000000003" });
  mocks.upload.mockResolvedValue({ ok: true, value: undefined });
  mocks.archive.mockResolvedValue({ ok: true, value: active.id });
  setRows([active, archived]);
});
afterEach(cleanup);

describe("Dokumentacija page", () => {
  it("shows exact decimal text, localized categories and read-only archived PDF actions", () => {
    render(<DocumentationPage />);
    expect(screen.getAllByText("12345678901234567890.123456789")).toHaveLength(2);
    expect(screen.getByText("Uvoz")).toBeInTheDocument();
    expect(screen.getByText("Izvoz")).toBeInTheDocument();
    const archivedRow = screen.getByText("Old export").closest("tr");
    expect(archivedRow).toHaveTextContent("Archived");
    expect(archivedRow).toHaveTextContent("Open");
    expect(archivedRow).toHaveTextContent("Download");
    expect(archivedRow).not.toHaveTextContent("Edit");
    expect(archivedRow).not.toHaveTextContent("Remove PDF");
    expect(archivedRow).not.toHaveTextContent("Replace PDF");
  });

  it("handles loading, retryable error and empty states", () => {
    mocks.useQuery.mockReturnValueOnce({ isPending: true });
    const view = render(<DocumentationPage />);
    expect(screen.getByText("Loading Documentation...")).toBeInTheDocument();
    view.unmount();
    mocks.useQuery.mockReturnValueOnce({ isPending: false, isError: true, refetch: mocks.refetch });
    const errorView = render(<DocumentationPage />);
    expect(screen.getByText("Unable to load Documentation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(mocks.refetch).toHaveBeenCalled();
    errorView.unmount();
    setRows([]);
    render(<DocumentationPage />);
    expect(screen.getByText("No documents")).toBeInTheDocument();
  });

  it("requires archive confirmation and preserves the PDF in the UI contract", async () => {
    render(<DocumentationPage />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(screen.getByText(/attached PDF remains preserved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.archive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith(active.id));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps a created record if optional PDF upload fails", async () => {
    setRows([]);
    mocks.upload.mockResolvedValue({ ok: false, error: "PDF failed." });
    render(<DocumentationPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add Document" }));
    fireEvent.change(screen.getByLabelText("Naziv"), { target: { value: "  Invoice  " } });
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByLabelText("Iznos"), { target: { value: "0" } });
    const file = new File(["%PDF-"], "invoice.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("PDF (optional)"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "Invoice", amount: "0",
    })));
    await waitFor(() => expect(screen.getByText(/Document created, but PDF upload failed/)).toBeInTheDocument());
    expect(mocks.upload).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000003", file);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["documentation", "admin-profile", "list"], exact: true });
  });

  it("rejects blank name, missing date, negative and malformed amounts before create", async () => {
    setRows([]);
    render(<DocumentationPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add Document" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Naziv is required.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Naziv/ }), { target: { value: "Invoice" } });
    fireEvent.change(screen.getByLabelText(/Datum/), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Iznos/ }), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a non-negative decimal amount.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Iznos/ }), { target: { value: "1e3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("edits only active records and sends exact decimal text", async () => {
    mocks.update.mockResolvedValue({ ok: true, value: active.id });
    render(<DocumentationPage />);
    fireEvent.click(within(screen.getByText("Import invoice").closest("tr")!).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Naziv")).toHaveValue("Import invoice");
    expect(screen.getByLabelText("Iznos")).toHaveValue(active.amount);
    fireEvent.change(screen.getByLabelText("Iznos"), { target: { value: "0001.2300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(active.id, expect.objectContaining({ amount: "1.23" })));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["documentation", "admin-profile", "list"], exact: true });
    expect(within(screen.getByText("Old export").closest("tr")!).queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
