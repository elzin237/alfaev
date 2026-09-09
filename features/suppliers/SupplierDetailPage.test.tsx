import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const detailPageMocks = vi.hoisted(() => ({
  useSupplierDetail: vi.fn(),
  archive: vi.fn(),
  refetch: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./hooks/useSupplierDetail", () => ({
  useSupplierDetail: detailPageMocks.useSupplierDetail,
}));

import SupplierDetailPage from "./SupplierDetailPage";
import type { Supplier } from "./services/supplierService";

const activeSupplier: Supplier = {
  id: "supplier-1",
  name: "Bosch",
  country: "Germany",
  contactPersonName: "Mira Marić",
  contactPhone: "+387 61 111 222",
  contactEmail: "mira@bosch.example",
  isActive: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T11:00:00.000Z",
  archivedAt: null,
};

function setHookState(options: {
  canEdit?: boolean;
  canArchive?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?:
    | { ok: true; value: Supplier }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  detailPageMocks.useSupplierDetail.mockReturnValue({
    canEdit: options.canEdit ?? true,
    canArchive: options.canArchive ?? true,
    supplierQuery: {
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      data: options.data ?? { ok: true, value: activeSupplier },
      refetch: detailPageMocks.refetch,
    },
    update: detailPageMocks.update,
    archive: detailPageMocks.archive,
  });
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/suppliers/supplier-1"]}>
      <Routes>
        <Route path="/suppliers/:supplierId" element={<SupplierDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  detailPageMocks.update.mockResolvedValue({
    ok: true,
    value: { supplierId: "supplier-1" },
  });
  detailPageMocks.archive.mockResolvedValue({
    ok: true,
    value: { supplierId: "supplier-1" },
  });
  setHookState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SupplierDetailPage", () => {
  it("renders loading without exposing Supplier content", () => {
    setHookState({ isPending: true });
    renderDetail();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Supplier details...",
    );
    expect(screen.queryByText("Bosch")).not.toBeInTheDocument();
  });

  it("renders a safe read error with retry", () => {
    setHookState({
      data: {
        ok: false,
        error: {
          code: "supplier_detail_failed",
          message: "The Supplier details could not be loaded.",
        },
      },
    });
    renderDetail();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Supplier details could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(detailPageMocks.refetch).toHaveBeenCalledOnce();
  });

  it("renders a distinct not-found state without a pointless retry", () => {
    setHookState({
      data: {
        ok: false,
        error: {
          code: "supplier_not_found",
          message: "The Supplier could not be found.",
        },
      },
    });
    renderDetail();

    expect(screen.getByRole("alert")).toHaveTextContent("Supplier not found");
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("shows all core contact, status, and date fields for an active Supplier", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: "Bosch" })).toBeInTheDocument();
    expect(screen.getByText("Germany")).toBeInTheDocument();
    expect(screen.getByText("Mira Marić")).toBeInTheDocument();
    expect(screen.getByText("mira@bosch.example")).toBeInTheDocument();
    expect(screen.getByText("+387 61 111 222")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Not archived")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Suppliers" }))
      .toHaveAttribute("href", "/suppliers");
  });

  it("keeps archived Suppliers readable and exposes no edit/archive/restore controls", () => {
    setHookState({
      canEdit: false,
      canArchive: false,
      data: {
        ok: true,
        value: {
          ...activeSupplier,
          isActive: false,
          archivedAt: "2026-09-03T12:00:00.000Z",
        },
      },
    });
    renderDetail();

    expect(screen.getByRole("heading", { name: "Bosch" })).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: /edit|archive|delete|restore|reactivate/i,
    })).not.toBeInTheDocument();
  });

  it("hides Edit and Archive for view-only or failed permission checks", () => {
    setHookState({ canEdit: false, canArchive: false });
    renderDetail();

    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Supplier" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Supplier" }))
      .not.toBeInTheDocument();
  });

  it("prefills, validates, and submits the normalized Supplier edit form", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Edit Supplier" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Supplier" });

    expect(within(dialog).getByLabelText("Supplier Name")).toHaveValue("Bosch");
    expect(within(dialog).getByLabelText("Country")).toHaveValue("Germany");
    expect(within(dialog).getByLabelText("Contact Person")).toHaveValue("Mira Marić");
    expect(within(dialog).getByLabelText("Phone")).toHaveValue("+387 61 111 222");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("mira@bosch.example");

    fireEvent.change(within(dialog).getByLabelText("Country"), {
      target: { value: "   " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    expect(await within(dialog).findByText("Country is required."))
      .toBeInTheDocument();
    expect(detailPageMocks.update).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Country"), {
      target: { value: "  Austria  " },
    });
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "  SALES@BOSCH.EXAMPLE  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(detailPageMocks.update).toHaveBeenCalledWith({
      name: "Bosch",
      country: "Austria",
      contactPersonName: "Mira Marić",
      contactPhone: "+387 61 111 222",
      contactEmail: "sales@bosch.example",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Supplier updated.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the edit dialog open with useful input after a safe update failure", async () => {
    detailPageMocks.update.mockResolvedValue({
      ok: false,
      error: {
        code: "supplier_duplicate",
        message: "A Supplier with this name already exists.",
      },
    });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Edit Supplier" }));
    fireEvent.change(screen.getByLabelText("Supplier Name"), {
      target: { value: "ABB" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A Supplier with this name already exists.",
    );
    expect(screen.getByLabelText("Supplier Name")).toHaveValue("ABB");
    expect(screen.getByRole("dialog", { name: "Edit Supplier" }))
      .toBeInTheDocument();
  });

  it("requires explicit archive confirmation and cancellation makes no request", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Archive Supplier" }));

    const dialog = screen.getByRole("dialog", { name: "Archive Supplier" });
    expect(dialog).toHaveTextContent("remain in historical records");
    expect(dialog).toHaveTextContent(
      "cannot be used for new Supplier relationships or selections in future workflows",
    );
    expect(dialog).toHaveTextContent("reactivation is not currently supported");
    expect(detailPageMocks.archive).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Archive Supplier" }))
      .not.toBeInTheDocument();
    expect(detailPageMocks.archive).not.toHaveBeenCalled();
  });

  it("blocks duplicate archive submission and shows success", async () => {
    let resolveArchive:
      | ((result: {
          ok: true;
          value: { supplierId: string };
        }) => void)
      | undefined;
    const pendingArchive = new Promise<{
      ok: true;
      value: { supplierId: string };
    }>((resolve) => {
      resolveArchive = resolve;
    });
    detailPageMocks.archive.mockReturnValue(pendingArchive);
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Archive Supplier" }));
    const confirm = within(
      screen.getByRole("dialog", { name: "Archive Supplier" }),
    ).getByRole("button", { name: "Archive Supplier" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(detailPageMocks.archive).toHaveBeenCalledOnce());
    expect(confirm).toBeDisabled();
    resolveArchive?.({ ok: true, value: { supplierId: "supplier-1" } });
    await pendingArchive;

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Supplier archived.",
    );
    expect(screen.queryByRole("dialog", { name: "Archive Supplier" }))
      .not.toBeInTheDocument();
  });

  it("shows a safe archive failure and keeps confirmation open", async () => {
    detailPageMocks.archive.mockResolvedValue({
      ok: false,
      error: {
        code: "supplier_archive_failed",
        message: "The Supplier could not be archived. Please try again.",
      },
    });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Archive Supplier" }));
    fireEvent.click(within(
      screen.getByRole("dialog", { name: "Archive Supplier" }),
    ).getByRole("button", { name: "Archive Supplier" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Supplier could not be archived. Please try again.",
    );
    expect(screen.getByRole("dialog", { name: "Archive Supplier" }))
      .toBeInTheDocument();
  });

  it("does not add archive, ProductSupplier, Catalog Number, or procurement sections", () => {
    renderDetail();

    expect(screen.queryByText(/ProductSupplier/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Catalog Number/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/procurement history/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete|restore|reactivate/i }))
      .not.toBeInTheDocument();
  });
});
