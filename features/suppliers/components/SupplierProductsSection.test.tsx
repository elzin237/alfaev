import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sectionMocks = vi.hoisted(() => ({
  useSupplierProducts: vi.fn(),
  refetchRelations: vi.fn(),
  refetchProducts: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
}));

vi.mock("../hooks/useSupplierProducts", () => ({
  useSupplierProducts: sectionMocks.useSupplierProducts,
}));

import type {
  ProductSupplierProductChoice,
  SupplierProductRelation,
} from "../../inventory/services/productSupplierService";
import SupplierProductsSection from "./SupplierProductsSection";

const activeProduct: ProductSupplierProductChoice = {
  productId: "product-active",
  serialNumber: "0000001",
  productName: "Controller",
};
const activeRelation: SupplierProductRelation = {
  relationId: "relation-active",
  productId: activeProduct.productId,
  productSerialNumber: activeProduct.serialNumber,
  productName: activeProduct.productName,
  productIsActive: true,
  catalogNumber: "AbC-42",
  description: "Control cabinet relay",
  isActive: true,
};
const historicalRelation: SupplierProductRelation = {
  relationId: "relation-archived",
  productId: "product-archived",
  productSerialNumber: "0000002",
  productName: "Legacy Controller",
  productIsActive: false,
  catalogNumber: null,
  description: null,
  isActive: false,
};

function setHookState(options: {
  relations?: SupplierProductRelation[];
  canManage?: boolean;
  canAdd?: boolean;
  relationPending?: boolean;
  relationData?:
    | { ok: true; value: SupplierProductRelation[] }
    | { ok: false; error: { code: string; message: string } };
  productsPending?: boolean;
  productsData?:
    | { ok: true; value: ProductSupplierProductChoice[] }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  sectionMocks.useSupplierProducts.mockReturnValue({
    canManage: options.canManage ?? true,
    canAdd: options.canAdd ?? true,
    relationQuery: {
      isPending: options.relationPending ?? false,
      isError: false,
      data: options.relationData ?? {
        ok: true,
        value: options.relations ?? [activeRelation, historicalRelation],
      },
      refetch: sectionMocks.refetchRelations,
    },
    productsQuery: {
      isPending: options.productsPending ?? false,
      isError: false,
      data: options.productsData ?? { ok: true, value: [activeProduct] },
      refetch: sectionMocks.refetchProducts,
    },
    create: sectionMocks.create,
    update: sectionMocks.update,
    archive: sectionMocks.archive,
  });
}

function renderSection(supplierIsActive = true) {
  return render(
    <SupplierProductsSection
      supplierId="supplier-1"
      supplierName="Bosch"
      supplierIsActive={supplierIsActive}
    />,
  );
}

beforeEach(() => {
  sectionMocks.create.mockResolvedValue({ ok: true, value: { relationId: "new" } });
  sectionMocks.update.mockResolvedValue({ ok: true, value: { relationId: "relation-active" } });
  sectionMocks.archive.mockResolvedValue({ ok: true, value: { relationId: "relation-active" } });
  setHookState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SupplierProductsSection", () => {
  it("renders loading, safe error with retry, and empty states", () => {
    setHookState({ relationPending: true });
    const rendered = renderSection();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Product links...");

    setHookState({
      relationData: {
        ok: false,
        error: { code: "product_link_list_failed", message: "Safe read failure." },
      },
    });
    rendered.rerender(
      <SupplierProductsSection supplierId="supplier-1" supplierName="Bosch" supplierIsActive />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Safe read failure.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sectionMocks.refetchRelations).toHaveBeenCalledOnce();

    setHookState({ relations: [], canManage: false, canAdd: false });
    rendered.rerender(
      <SupplierProductsSection supplierId="supplier-1" supplierName="Bosch" supplierIsActive />,
    );
    expect(screen.getByRole("heading", { name: "No Product links" })).toBeInTheDocument();
  });

  it("renders active and archived relationships, archived Products, and nullable Catalog Numbers", () => {
    renderSection();

    expect(screen.getByText("0000001")).toBeInTheDocument();
    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.getByText("AbC-42")).toBeInTheDocument();
    expect(screen.getByText("Legacy Controller")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("Control cabinet relay")).toBeInTheDocument();
    expect(screen.getByText("Archived Product")).toBeInTheDocument();
    const historicalRow = screen.getByText("Legacy Controller").closest("tr");
    expect(within(historicalRow as HTMLElement).queryByRole("button", {
      name: /edit|archive/i,
    })).not.toBeInTheDocument();
  });

  it("keeps view-only, pending, and failed permission states read-only", () => {
    setHookState({ canManage: false, canAdd: false });
    renderSection();

    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add product|edit|archive/i }))
      .not.toBeInTheDocument();
  });

  it("offers Add only for an active Supplier and lists only trusted active Product choices", () => {
    const rendered = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    const dialog = screen.getByRole("dialog", { name: "Add Product Link" });
    const select = within(dialog).getByLabelText("Product");
    expect(within(select).getByRole("option", { name: "0000001 — Controller" }))
      .toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: /Legacy Controller/ }))
      .not.toBeInTheDocument();

    rendered.unmount();
    setHookState({ canManage: true, canAdd: false });
    renderSection(false);
    expect(screen.queryByRole("button", { name: "Add Product" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("validates Product, normalizes Catalog Number, and reuses the shared create mutation", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    const dialog = screen.getByRole("dialog", { name: "Add Product Link" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Product" }));
    expect(await within(dialog).findByText("Select a Product.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Product"), {
      target: { value: "product-active" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Catalog Number/), {
      target: { value: "  AbC-77  " },
    });
    fireEvent.change(within(dialog).getByLabelText(/Description/), {
      target: { value: "  Supplier relay  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Product" }));

    await waitFor(() => expect(sectionMocks.create).toHaveBeenCalledWith({
      productId: "product-active",
      catalogNumber: "AbC-77",
      description: "Supplier relay",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Product link added.");
  });

  it("edits only Catalog Number and requires confirmation before archive", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit Supplier Link" });
    expect(within(editDialog).queryByLabelText("Product")).not.toBeInTheDocument();
    fireEvent.change(within(editDialog).getByLabelText(/Catalog Number/), {
      target: { value: "  New-Cat  " },
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(sectionMocks.update).toHaveBeenCalledWith(
      "relation-active",
      { catalogNumber: "New-Cat", description: "Control cabinet relay" },
    ));

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const archiveDialog = screen.getByRole("dialog", { name: "Archive Product Link" });
    expect(sectionMocks.archive).not.toHaveBeenCalled();
    fireEvent.click(within(archiveDialog).getByRole("button", { name: "Cancel" }));
    expect(sectionMocks.archive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive Link" }));
    await waitFor(() => expect(sectionMocks.archive).toHaveBeenCalledWith("relation-active"));
    expect(await screen.findByRole("status")).toHaveTextContent("Product link archived.");
  });

  it("adds no Delete, Restore, quantity, stock, or procurement behavior", () => {
    renderSection();
    expect(screen.queryByRole("button", { name: /delete|restore|reactivate/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/quantity|stock|procurement/i)).not.toBeInTheDocument();
  });
});
