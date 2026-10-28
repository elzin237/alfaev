import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(), invalidateQueries: vi.fn(), refetch: vi.fn(),
  list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(),
  upload: vi.fn(), remove: vi.fn(), fetch: vi.fn(), download: vi.fn(), useAuth: vi.fn(),
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
  downloadPdfBlob: mocks.download,
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
  mocks.remove.mockResolvedValue({ ok: true, value: undefined });
  mocks.fetch.mockResolvedValue({
    ok: true,
    value: new Blob(["%PDF-1.7"], { type: "application/pdf" }),
  });
  mocks.archive.mockResolvedValue({ ok: true, value: active.id });
  setRows([active, archived]);
});
afterEach(cleanup);

describe("Documentation page", () => {
  it("shows exact decimal text, localized categories and read-only archived PDF actions", () => {
    render(<DocumentationPage />);
    expect(screen.getAllByText("12345678901234567890.123456789")).toHaveLength(2);
    expect(screen.getByText("Import")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
    const archivedRow = screen.getByText("Old export").closest("tr");
    expect(archivedRow).toHaveTextContent("Archived");
    expect(archivedRow).toHaveTextContent("Open");
    expect(archivedRow).toHaveTextContent("Download");
    expect(archivedRow).not.toHaveTextContent("Edit");
    expect(archivedRow).not.toHaveTextContent("Remove PDF");
    expect(archivedRow).not.toHaveTextContent("Replace PDF");
    expect(within(archivedRow!).queryByRole("button", { name: /PDF actions/ })).not.toBeInTheDocument();
  });

  it("uses a clear action hierarchy and keeps PDF maintenance inside its menu", async () => {
    render(<DocumentationPage />);
    const activeRow = screen.getByText("Import invoice").closest("tr")!;
    const open = within(activeRow).getByRole("button", { name: "Open" });
    const download = within(activeRow).getByRole("button", { name: "Download" });
    const edit = within(activeRow).getByRole("button", { name: "Edit" });
    const pdfMenuButton = within(activeRow).getByRole("button", {
      name: "PDF actions for Import invoice",
    });
    const archive = within(activeRow).getByRole("button", { name: "Archive" });

    expect(open).toHaveClass("border-red-600");
    expect(download).toHaveClass("border-zinc-300");
    expect(edit).not.toHaveClass("border");
    expect(archive).toHaveClass("text-red-700");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(pdfMenuButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(pdfMenuButton);
    const menu = await screen.findByRole("menu", { name: "PDF actions for Import invoice" });
    expect(pdfMenuButton).toHaveAttribute("aria-expanded", "true");
    const replace = within(menu).getByRole("menuitem", { name: "Replace PDF" });
    expect(replace).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Remove PDF" })).toHaveClass("text-red-700");
    expect(within(menu).queryByRole("menuitem", { name: "Archive" })).not.toBeInTheDocument();
    expect(archive).toBeInTheDocument();
    const fileInputClick = vi.spyOn(screen.getByLabelText("Select PDF"), "click");
    fireEvent.click(replace);
    expect(fileInputClick).toHaveBeenCalledOnce();
  });

  it("preserves Remove PDF confirmation and does not remove from the menu immediately", async () => {
    render(<DocumentationPage />);
    const activeRow = screen.getByText("Import invoice").closest("tr")!;
    fireEvent.click(within(activeRow).getByRole("button", { name: "PDF actions for Import invoice" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove PDF" }));

    expect(mocks.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Remove PDF" });
    expect(dialog).toHaveTextContent("Remove this PDF attachment");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove PDF" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(active.id));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["documentation", "admin-profile", "list"],
      exact: true,
    });
  });

  it("supports keyboard menu navigation, Escape, and outside-click closing", async () => {
    render(<DocumentationPage />);
    const activeRow = screen.getByText("Import invoice").closest("tr")!;
    const trigger = within(activeRow).getByRole("button", { name: "PDF actions for Import invoice" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const replace = await screen.findByRole("menuitem", { name: "Replace PDF" });
    const remove = screen.getByRole("menuitem", { name: "Remove PDF" });
    await waitFor(() => expect(replace).toHaveFocus());
    fireEvent.keyDown(replace, { key: "ArrowDown" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens an ephemeral in-app viewer, restores focus, and refetches after reopening", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const create = vi.fn()
      .mockReturnValueOnce("blob:documentation-first")
      .mockReturnValueOnce("blob:documentation-second");
    const revoke = vi.fn();
    const windowOpen = vi.spyOn(window, "open");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    try {
      render(<DocumentationPage />);
      const activeRow = screen.getByText("Import invoice").closest("tr")!;
      const open = within(activeRow).getByRole("button", { name: "Open" });
      open.focus();
      fireEvent.click(open);

      expect(screen.getByText("Preparing document PDF...")).toBeInTheDocument();
      expect(await screen.findByTitle("Import invoice PDF"))
        .toHaveAttribute("src", "blob:documentation-first");
      expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(active.id, "open");
      expect(windowOpen).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Close PDF viewer" }));
      await waitFor(() => expect(open).toHaveFocus());
      expect(revoke).toHaveBeenCalledWith("blob:documentation-first");

      fireEvent.click(open);
      expect(await screen.findByTitle("Import invoice PDF"))
        .toHaveAttribute("src", "blob:documentation-second");
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(within(activeRow).getByRole("button", { name: "Open" })).toBeDisabled();
    } finally {
      windowOpen.mockRestore();
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreate });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevoke });
    }
  });

  it("keeps Download separate and does not offer PDF actions without an attachment", async () => {
    render(<DocumentationPage />);
    const activeRow = screen.getByText("Import invoice").closest("tr")!;
    fireEvent.click(within(activeRow).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(active.id, "download"));
    expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), active.id);
    expect(screen.queryByRole("dialog", { name: "Document PDF" })).not.toBeInTheDocument();

    cleanup();
    setRows([{ ...active, pdfStoragePath: null }]);
    render(<DocumentationPage />);
    const noPdfRow = screen.getByText("Import invoice").closest("tr")!;
    expect(noPdfRow).toHaveTextContent("None");
    expect(within(noPdfRow).queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    expect(within(noPdfRow).queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    const pdfMenuButton = within(noPdfRow).getByRole("button", {
      name: "PDF actions for Import invoice",
    });
    fireEvent.click(pdfMenuButton);
    const menu = screen.getByRole("menu", { name: "PDF actions for Import invoice" });
    expect(within(menu).getByRole("menuitem", { name: "Upload PDF" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Replace PDF" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Remove PDF" })).not.toBeInTheDocument();
  });

  it("shows a safe access failure inside the viewer without raw authorization details", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      error: "PDF could not be loaded. Please try again.",
    });
    render(<DocumentationPage />);
    fireEvent.click(within(screen.getByText("Import invoice").closest("tr")!)
      .getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PDF could not be loaded. Please try again.",
    );
    expect(screen.queryByText(/permission denied|service role|popup/i)).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Invoice  " } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0" } });
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
    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), { target: { value: "Invoice" } });
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: "2026-09-16" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Amount/ }), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a non-negative decimal amount.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Amount/ }), { target: { value: "1e3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("edits only active records and sends exact decimal text", async () => {
    mocks.update.mockResolvedValue({ ok: true, value: active.id });
    render(<DocumentationPage />);
    fireEvent.click(within(screen.getByText("Import invoice").closest("tr")!).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Import invoice");
    expect(screen.getByLabelText("Amount")).toHaveValue(active.amount);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0001.2300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(active.id, expect.objectContaining({ amount: "1.23" })));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["documentation", "admin-profile", "list"], exact: true });
    expect(within(screen.getByText("Old export").closest("tr")!).queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
