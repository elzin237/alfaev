import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sectionMocks = vi.hoisted(() => ({
  useSupplierProducts: vi.fn(),
  refetchRelations: vi.fn(),
  refetchProducts: vi.fn(),
  create: vi.fn(),
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

  it("renders active and archived relationships without per-Product Supplier metadata", () => {
    renderSection();

    expect(screen.getByText("0000001")).toBeInTheDocument();
    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.getByText("Legacy Controller")).toBeInTheDocument();
    expect(screen.queryByText("AbC-42")).not.toBeInTheDocument();
    expect(screen.queryByText("Control cabinet relay")).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("contains keyboard focus, closes on Escape, and resets before reopening", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    let dialog = screen.getByRole("dialog", { name: "Add Product Link" });
    const productSelect = within(dialog).getByLabelText("Product");
    const submit = within(dialog).getByRole("button", { name: "Add Product" });

    await waitFor(() => expect(productSelect).toHaveFocus());

    submit.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(productSelect).toHaveFocus();

    productSelect.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(submit).toHaveFocus();

    fireEvent.change(productSelect, { target: { value: "product-active" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add Product Link" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    dialog = screen.getByRole("dialog", { name: "Add Product Link" });
    const reopenedSelect = within(dialog).getByLabelText("Product");
    await waitFor(() => expect(reopenedSelect).toHaveFocus());
    expect(reopenedSelect).toHaveValue("");
    expect(within(dialog).queryByLabelText(/Catalog Number|Description/))
      .not.toBeInTheDocument();
  });

  it("validates Product and creates a relationship without Catalog or Description input", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    const dialog = screen.getByRole("dialog", { name: "Add Product Link" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Product" }));
    expect(await within(dialog).findByText("Select a Product.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Product"), {
      target: { value: "product-active" },
    });
    expect(within(dialog).queryByLabelText(/Catalog Number/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Description/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Product" }));

    await waitFor(() => expect(sectionMocks.create).toHaveBeenCalledWith({
      productId: "product-active",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Product link added.");
  });

  it("blocks duplicate Add and unsafe keyboard closure while submission is pending", async () => {
    let resolveCreate: ((value: {
      ok: true;
      value: { relationId: string };
    }) => void) | undefined;
    sectionMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Add Product" }));
    const dialog = screen.getByRole("dialog", { name: "Add Product Link" });
    fireEvent.change(within(dialog).getByLabelText("Product"), {
      target: { value: "product-active" },
    });
    const submit = within(dialog).getByRole("button", { name: "Add Product" });

    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(sectionMocks.create).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("button", { name: "Saving..." }))
      .toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Add Product Link" }))
      .toBeInTheDocument();

    resolveCreate?.({ ok: true, value: { relationId: "new" } });
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Add Product Link",
    })).not.toBeInTheDocument());
  });

  it("offers no relationship edit and requires confirmation before archive", async () => {
    renderSection();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();

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
