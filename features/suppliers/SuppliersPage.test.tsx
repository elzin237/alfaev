import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const suppliersPageMocks = vi.hoisted(() => ({
  useSuppliers: vi.fn(),
  refetch: vi.fn(),
  create: vi.fn(),
}));

vi.mock("./hooks/useSuppliers", () => ({
  useSuppliers: suppliersPageMocks.useSuppliers,
}));

import SuppliersPage from "./SuppliersPage";
import type { Supplier } from "./services/supplierService";

function SuppliersPageUnderTest() {
  return (
    <MemoryRouter>
      <SuppliersPage />
    </MemoryRouter>
  );
}

const activeSupplier: Supplier = {
  id: "supplier-active",
  name: "Bosch",
  catalogNumber: "BOSCH-26",
  description: "Industrial controls",
  country: "Germany",
  contactPersonName: "Mira Marić",
  contactPhone: "+387 61 111 222",
  contactEmail: "mira@bosch.example",
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  archivedAt: null,
};

const archivedSupplier: Supplier = {
  id: "supplier-archived",
  name: "ABB",
  catalogNumber: null,
  description: null,
  country: "Switzerland",
  contactPersonName: null,
  contactPhone: null,
  contactEmail: null,
  isActive: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  archivedAt: "2026-08-02T00:00:00.000Z",
};

function setHookState(options: {
  canCreate?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?:
    | { ok: true; value: Supplier[] }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  suppliersPageMocks.useSuppliers.mockReturnValue({
    canCreate: options.canCreate ?? true,
    suppliersQuery: {
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      data: options.data ?? {
        ok: true,
        value: [activeSupplier, archivedSupplier],
      },
      refetch: suppliersPageMocks.refetch,
    },
    create: suppliersPageMocks.create,
  });
}

beforeEach(() => {
  suppliersPageMocks.create.mockResolvedValue({
    ok: true,
    value: { supplierId: "supplier-new" },
  });
  setHookState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SuppliersPage", () => {
  it("renders loading, safe error with retry, and a true empty state", () => {
    setHookState({ isPending: true });
    const rendered = render(<SuppliersPageUnderTest />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Suppliers...");

    setHookState({
      data: {
        ok: false,
        error: {
          code: "supplier_list_failed",
          message: "The Supplier list could not be loaded.",
        },
      },
    });
    rendered.rerender(<SuppliersPageUnderTest />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Supplier list could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(suppliersPageMocks.refetch).toHaveBeenCalledOnce();

    setHookState({ data: { ok: true, value: [] }, canCreate: false });
    rendered.rerender(<SuppliersPageUnderTest />);
    expect(screen.getByRole("heading", { name: "No Suppliers found" }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Search Suppliers")).not.toBeInTheDocument();
  });

  it("renders active and archived Supplier details and status text", () => {
    render(<SuppliersPageUnderTest />);

    const activeRow = screen.getByRole("row", {
      name: /Bosch BOSCH-26 Germany Mira Marić mira@bosch.example \+387 61 111 222 Active/,
    });
    const archivedRow = screen.getByRole("row", { name: /ABB — Switzerland.*Archived/ });
    const rows = screen.getAllByRole("row");

    expect(rows.indexOf(activeRow)).toBeLessThan(rows.indexOf(archivedRow));
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bosch" })).toHaveAttribute(
      "href",
      "/suppliers/supplier-active",
    );
  });

  it("searches immediately across displayed fields and clearing restores the list", () => {
    render(<SuppliersPageUnderTest />);
    const search = screen.getByLabelText("Search Suppliers");

    fireEvent.change(search, { target: { value: "  MIRA@BOSCH  " } });
    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.queryByText("ABB")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "no match" } });
    expect(screen.getByRole("heading", { name: "No matching Suppliers" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Bosch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.getByText("ABB")).toBeInTheDocument();
  });

  it("hides Add Supplier for a view-only or unresolved create permission", () => {
    setHookState({ canCreate: false });
    render(<SuppliersPageUnderTest />);

    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Supplier" }))
      .not.toBeInTheDocument();
  });

  it("opens Add Supplier and shows success after creation", async () => {
    render(<SuppliersPageUnderTest />);

    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));
    expect(screen.getByRole("dialog", { name: "Add Supplier" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Supplier Name"), {
      target: { value: " Siemens " },
    });
    fireEvent.change(screen.getByLabelText("Catalog Number"), {
      target: { value: " SIEMENS-26 " },
    });
    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: " Germany " },
    });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Add Supplier" }))
        .getByRole("button", { name: "Add Supplier" }),
    );

    await waitFor(() => expect(suppliersPageMocks.create).toHaveBeenCalledWith({
      name: "Siemens",
      catalogNumber: "SIEMENS-26",
      description: null,
      country: "Germany",
      contactPersonName: null,
      contactPhone: null,
      contactEmail: null,
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Supplier added.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("contains no Task 044+ actions or Product/procurement functionality", () => {
    render(<SuppliersPageUnderTest />);

    expect(screen.queryByRole("button", {
      name: /edit|archive|delete|restore|reactivate/i,
    })).not.toBeInTheDocument();
    expect(screen.queryByText(/ProductSupplier/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/procurement workflow/i)).not.toBeInTheDocument();
  });
});
