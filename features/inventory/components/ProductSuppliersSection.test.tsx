import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sectionMocks = vi.hoisted(() => ({
  useProductSuppliers: vi.fn(),
  refetchRelations: vi.fn(),
  refetchSuppliers: vi.fn(),
  create: vi.fn(),
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
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("contains keyboard focus, closes on Escape, and resets before reopening", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));
    let dialog = screen.getByRole("dialog", { name: "Add Supplier Link" });
    const supplierSelect = within(dialog).getByLabelText("Supplier");
    const submit = within(dialog).getByRole("button", { name: "Add Supplier" });

    await waitFor(() => expect(supplierSelect).toHaveFocus());

    submit.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(supplierSelect).toHaveFocus();

    supplierSelect.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(submit).toHaveFocus();

    fireEvent.change(supplierSelect, { target: { value: "supplier-active" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add Supplier Link" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));
    dialog = screen.getByRole("dialog", { name: "Add Supplier Link" });
    const reopenedSelect = within(dialog).getByLabelText("Supplier");
    await waitFor(() => expect(reopenedSelect).toHaveFocus());
    expect(reopenedSelect).toHaveValue("");
    expect(within(dialog).queryByLabelText(/Catalog Number|Description/))
      .not.toBeInTheDocument();
  });

  it("validates Supplier and reports relationship-only add success", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Supplier" }));
    const dialog = screen.getByRole("dialog", { name: "Add Supplier Link" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Add Supplier" }));
    expect(await within(dialog).findByText("Select a Supplier."))
      .toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Supplier"), {
      target: { value: "supplier-active" },
    });
    expect(within(dialog).queryByLabelText(/Catalog Number/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Description/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Supplier" }));

    await waitFor(() => expect(sectionMocks.create).toHaveBeenCalledWith({
      supplierId: "supplier-active",
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
    const submit = within(dialog).getByRole("button", { name: "Add Supplier" });

    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(sectionMocks.create).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("button", { name: "Saving..." }))
      .toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Add Supplier Link" }))
      .toBeInTheDocument();

    resolveCreate?.({ ok: true, value: { relationId: "relation-new" } });
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Add Supplier Link",
    })).not.toBeInTheDocument());
  });

  it("does not offer relationship-level Catalog or Description editing", () => {
    renderSection();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
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
