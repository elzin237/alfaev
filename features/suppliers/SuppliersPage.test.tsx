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

const provenanceSupplier: Supplier = {
  id: "022231cd-0000-4000-8000-000000caed25",
  name: "Provenance Supplier",
  catalogNumber: "TASK148-b2b16f58-very-long-catalog-number",
  description: "Internal / provenance supplier",
  country: "Bosnia and Herzegovina",
  contactPersonName: null,
  contactPhone: null,
  contactEmail: null,
  isActive: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  archivedAt: null,
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

  it("matches the approved header, search, and Supplier table hierarchy", () => {
    render(<SuppliersPageUnderTest />);

    expect(screen.getByRole("heading", { name: "Suppliers" })).toBeInTheDocument();
    expect(screen.getByText("Manage supplier master data and default catalog information."))
      .toBeInTheDocument();
    expect(screen.getByPlaceholderText(
      "Search by supplier name, catalog number, country, or contact details",
    )).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Supplier" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Actions" }))
      .not.toBeInTheDocument();

    const activeRow = screen.getByText("Bosch").closest("tr")!;
    const archivedRow = screen.getByText("ABB").closest("tr")!;
    const rows = screen.getAllByRole("row");

    expect(rows.indexOf(activeRow)).toBeLessThan(rows.indexOf(archivedRow));
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(within(activeRow).getByText("Industrial controls")).toBeInTheDocument();
    expect(within(activeRow).getByText("Mira Marić")).toBeInTheDocument();
    expect(within(activeRow).getByText("mira@bosch.example")).toBeInTheDocument();
    expect(within(activeRow).getByText("+387 61 111 222")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
    expect(within(archivedRow).getByText("No contact details")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bosch" })).toHaveAttribute(
      "href",
      "/suppliers/supplier-active",
    );
    expect(screen.getByText(/Showing/).parentElement).toHaveTextContent(
      "Showing 2 of 2 suppliers",
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

    fireEvent.change(search, { target: { value: "industrial controls" } });
    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.queryByText("ABB")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/).parentElement).toHaveTextContent(
      "Showing 1 of 2 suppliers",
    );
  });

  it("copies the exact Catalog Number without changing Supplier data", async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      render(<SuppliersPageUnderTest />);
      const catalog = screen.getByText("BOSCH-26");
      expect(catalog.parentElement).toHaveAttribute("title", "BOSCH-26");

      fireEvent.click(screen.getByRole("button", {
        name: "Copy Catalog Number BOSCH-26",
      }));
      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("BOSCH-26"));
      expect(screen.getByRole("button", {
        name: "Catalog Number copied for Bosch",
      })).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it("uses the accessible Supplier name link as the only row navigation control", () => {
    render(<SuppliersPageUnderTest />);
    const supplierLink = screen.getByRole("link", { name: "Bosch" });

    expect(supplierLink).toHaveAttribute("href", "/suppliers/supplier-active");
    supplierLink.focus();
    expect(supplierLink).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Supplier actions/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("uses lower-noise provenance presentation while preserving exact values", () => {
    setHookState({ data: { ok: true, value: [provenanceSupplier] } });
    render(<SuppliersPageUnderTest />);

    const row = screen.getByText("Provenance Supplier").closest("tr")!;
    expect(within(row).getByText("ID 022231cd…caed25")).toHaveAttribute(
      "title",
      provenanceSupplier.id,
    );
    const catalog = within(row).getByText(provenanceSupplier.catalogNumber!);
    expect(catalog.parentElement).toHaveAttribute(
      "title",
      provenanceSupplier.catalogNumber,
    );
    expect(within(row).getByText("No contact details")).toBeInTheDocument();
    expect(within(row).getByText("Internal / provenance supplier"))
      .toBeInTheDocument();
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
