import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sectionMocks = vi.hoisted(() => ({
  useProductSuppliers: vi.fn(),
  refetchRelations: vi.fn(),
  refetchSuppliers: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
}));

vi.mock("../hooks/useProductSuppliers", () => ({
  useProductSuppliers: sectionMocks.useProductSuppliers,
}));

import ProductSuppliersSection from "./ProductSuppliersSection";
import type {
  ProductSupplierChoice,
  ProductSupplierRelation,
} from "../services/productSupplierService";

const activeSupplier: ProductSupplierChoice = {
  supplierId: "supplier-active",
  supplierName: "ABB",
};
const activeRelation: ProductSupplierRelation = {
  relationId: "relation-active",
  supplierId: activeSupplier.supplierId,
  supplierName: activeSupplier.supplierName,
  catalogNumber: "AbC-42",
  description: "Control cabinet relay",
  isActive: true,
  supplierIsActive: true,
};
const historicalRelation: ProductSupplierRelation = {
  relationId: "relation-archived",
  supplierId: "supplier-archived",
  supplierName: "Legacy Supplier",
  catalogNumber: null,
  description: null,
  isActive: false,
  supplierIsActive: false,
};

function setHookState(options: {
  relations?: ProductSupplierRelation[];
  canManage?: boolean;
  canAdd?: boolean;
  relationPending?: boolean;
  relationError?: boolean;
  relationData?:
    | { ok: true; value: ProductSupplierRelation[] }
    | { ok: false; error: { code: string; message: string } };
  suppliersPending?: boolean;
  suppliersError?: boolean;
  suppliersData?:
    | { ok: true; value: ProductSupplierChoice[] }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  sectionMocks.useProductSuppliers.mockReturnValue({
    canManage: options.canManage ?? true,
    canAdd: options.canAdd ?? true,
    relationQuery: {
      isPending: options.relationPending ?? false,
      isError: options.relationError ?? false,
      data: options.relationData ?? {
        ok: true,
        value: options.relations ?? [activeRelation, historicalRelation],
      },
      refetch: sectionMocks.refetchRelations,
    },
    suppliersQuery: {
      isPending: options.suppliersPending ?? false,
      isError: options.suppliersError ?? false,
      data: options.suppliersData ?? {
        ok: true,
        value: [activeSupplier],
      },
      refetch: sectionMocks.refetchSuppliers,
    },
    create: sectionMocks.create,
    update: sectionMocks.update,
    archive: sectionMocks.archive,
  });
}

function renderSection(productIsActive = true) {
  return render(
    <ProductSuppliersSection
      productId="product-1"
      productName="Controller"
      productIsActive={productIsActive}
    />,
  );
}

beforeEach(() => {
  sectionMocks.create.mockResolvedValue({
    ok: true,
    value: { relationId: "relation-new" },
  });
  sectionMocks.update.mockResolvedValue({
    ok: true,
    value: { relationId: "relation-active" },
  });
  sectionMocks.archive.mockResolvedValue({
    ok: true,
    value: { relationId: "relation-active" },
  });
  setHookState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ProductSuppliersSection", () => {
  it("renders loading, safe error with retry, and empty states", () => {
    setHookState({ relationPending: true });
    const rendered = renderSection();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Supplier links...");

    setHookState({
      relationData: {
        ok: false,
        error: { code: "relationship_list_failed", message: "Safe read failure." },
      },
    });
    rendered.rerender(
      <ProductSuppliersSection
        productId="product-1"
        productName="Controller"
        productIsActive
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Safe read failure.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sectionMocks.refetchRelations).toHaveBeenCalledOnce();

    setHookState({ relations: [], canManage: false, canAdd: false });
    rendered.rerender(
      <ProductSuppliersSection
        productId="product-1"
        productName="Controller"
        productIsActive
      />,
    );
    expect(screen.getByRole("heading", { name: "No Supplier links" }))
      .toBeInTheDocument();
  });

  it("shows active and historical links, nullable Catalog Number, and archived Supplier state", () => {
    renderSection();

    expect(screen.getByText("ABB")).toBeInTheDocument();
    expect(screen.getByText("AbC-42")).toBeInTheDocument();
    expect(screen.getByText("Legacy Supplier")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("Control cabinet relay")).toBeInTheDocument();
    expect(screen.getAllByText("Archived")).toHaveLength(1);
    expect(screen.getByText("Archived Supplier")).toBeInTheDocument();

    const historicalRow = screen.getByText("Legacy Supplier").closest("tr");
    expect(historicalRow).not.toBeNull();
    expect(within(historicalRow as HTMLElement).queryByRole("button", {
      name: /edit|archive/i,
    })).not.toBeInTheDocument();
  });

  it("keeps view-only, pending, or failed permission states fully read-only", () => {
    setHookState({ canManage: false, canAdd: false });
    renderSection();

    expect(screen.getByText("ABB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add supplier|edit|archive/i }))
      .not.toBeInTheDocument();
  });

  it("offers Add only for an active Product and only lists active Suppliers", () => {
    const rendered = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));
    const dialog = screen.getByRole("dialog", { name: "Add Supplier Link" });
    const supplierSelect = within(dialog).getByLabelText("Supplier");

    expect(within(supplierSelect).getByRole("option", { name: "ABB" }))
      .toBeInTheDocument();
    expect(within(supplierSelect).queryByRole("option", {
      name: "Legacy Supplier",
    })).not.toBeInTheDocument();

    rendered.unmount();
    setHookState({ canManage: true, canAdd: false });
    renderSection(false);
    expect(screen.queryByRole("button", { name: "Add Supplier" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("validates Supplier, normalizes Catalog Number, and reports add success", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));
    const dialog = screen.getByRole("dialog", { name: "Add Supplier Link" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Add Supplier" }));
    expect(await within(dialog).findByText("Select a Supplier."))
      .toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Supplier"), {
      target: { value: "supplier-active" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Catalog Number/), {
      target: { value: "CAT-1" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Catalog Number/), {
      target: { value: "  AbC-77  " },
    });
    fireEvent.change(within(dialog).getByLabelText(/Description/), {
      target: { value: "  Supplier relay  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Supplier" }));

    await waitFor(() => expect(sectionMocks.create).toHaveBeenCalledWith({
      supplierId: "supplier-active",
      catalogNumber: "AbC-77",
      description: "Supplier relay",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Supplier link added.",
    );
    expect(screen.queryByRole("dialog", { name: "Add Supplier Link" }))
      .not.toBeInTheDocument();
  });

  it("blocks duplicate Add submissions while the trusted mutation is pending", async () => {
    let resolveCreate: ((value: {
      ok: true;
      value: { relationId: string };
    }) => void) | undefined;
    sectionMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));
    const dialog = screen.getByRole("dialog", { name: "Add Supplier Link" });
    fireEvent.change(within(dialog).getByLabelText("Supplier"), {
      target: { value: "supplier-active" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Catalog Number/), {
      target: { value: "CAT-1" },
    });
    const submit = within(dialog).getByRole("button", { name: "Add Supplier" });

    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(sectionMocks.create).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("button", { name: "Saving..." }))
      .toBeDisabled();

    resolveCreate?.({ ok: true, value: { relationId: "relation-new" } });
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Add Supplier Link",
    })).not.toBeInTheDocument());
  });

  it("edits only Catalog Number and surfaces a safe backend failure", async () => {
    sectionMocks.update.mockResolvedValue({
      ok: false,
      error: { code: "relationship_duplicate", message: "Safe duplicate error." },
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Supplier Link" });

    expect(within(dialog).getByText(/ABB/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Supplier")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Catalog Number/)).toHaveValue("AbC-42");
    fireEvent.change(within(dialog).getByLabelText(/Catalog Number/), {
      target: { value: "  New-Cat  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(sectionMocks.update).toHaveBeenCalledWith(
      "relation-active",
      { catalogNumber: "New-Cat", description: "Control cabinet relay" },
    ));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Safe duplicate error.",
    );
  });

  it("requires archive confirmation, supports Cancel, and reports success", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog", { name: "Archive Supplier Link" });

    expect(dialog).toHaveTextContent("remain in historical records");
    expect(dialog).toHaveTextContent("cannot be restored");
    expect(sectionMocks.archive).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(sectionMocks.archive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive Link" }));
    await waitFor(() => expect(sectionMocks.archive).toHaveBeenCalledWith(
      "relation-active",
    ));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Supplier link archived.",
    );
  });

  it("blocks duplicate archive submissions while pending", async () => {
    let resolveArchive: ((value: {
      ok: true;
      value: { relationId: string };
    }) => void) | undefined;
    sectionMocks.archive.mockReturnValue(new Promise((resolve) => {
      resolveArchive = resolve;
    }));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const confirm = screen.getByRole("button", { name: "Archive Link" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(sectionMocks.archive).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Archive Link…" })).toBeDisabled();

    resolveArchive?.({ ok: true, value: { relationId: "relation-active" } });
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Archive Supplier Link",
    })).not.toBeInTheDocument());
  });

  it("adds no Delete, Restore, quantity, stock, or Supplier-detail Product UI", () => {
    renderSection();

    expect(screen.queryByRole("button", { name: /delete|restore|reactivate/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/quantity|stock/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
