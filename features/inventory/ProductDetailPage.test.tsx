import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactNode } from "react";
import { INVENTORY_WAREHOUSES } from "./inventoryWarehouses";

const detailPageMocks = vi.hoisted(() => ({
  useProductDetail: vi.fn(),
  refetchProduct: vi.fn(),
  refetchBrands: vi.fn(),
  archive: vi.fn(),
  update: vi.fn(),
  useInventoryWarehouseAccess: vi.fn(),
  useInventoryLegacyViewPermission: vi.fn(),
  stockHealth: vi.fn(),
}));

vi.mock("./hooks/useProductDetail", () => ({
  useProductDetail: detailPageMocks.useProductDetail,
}));
vi.mock("./hooks/useInventoryWarehouseAccess", () => ({
  useInventoryWarehouseAccess: detailPageMocks.useInventoryWarehouseAccess,
  useInventoryLegacyViewPermission: detailPageMocks.useInventoryLegacyViewPermission,
}));
vi.mock("./components/ProductSuppliersSection", () => ({
  default: ({ productId, productName, productIsActive }: {
    productId: string;
    productName: string;
    productIsActive: boolean;
  }) => (
    <section aria-label="Product Supplier links">
      Suppliers for {productName} ({productId}) — {productIsActive ? "active" : "archived"}
    </section>
  ),
}));
vi.mock("./components/InventoryBalanceSection", () => ({
  default: ({ productId, productIsActive, stockHealth }: {
    productId: string;
    productIsActive: boolean;
    stockHealth?: ReactNode;
  }) => (
    <section aria-label="Product Inventory balance">
      Balance for {productId} — {productIsActive ? "active" : "archived"}
      {stockHealth}
    </section>
  ),
}));
vi.mock("./components/ProductStockHealthSection", () => ({ default: (props: unknown) => {
  detailPageMocks.stockHealth(props);
  return <div>Warehouse minimum configuration</div>;
} }));
vi.mock("./components/InventoryHistorySection", () => ({
  default: ({ productId }: { productId: string }) => (
    <section aria-label="Product Inventory history">
      Inventory history for {productId}
    </section>
  ),
}));
vi.mock("./components/ProductBarcodeSection", () => ({
  default: () => (
    <section aria-label="Product barcode">Barcode preview available</section>
  ),
}));
vi.mock("./components/SupplierStockHistorySection", () => ({
  default: ({ productId }: { productId: string }) => (
    <section aria-label="Supplier Stock History">
      Supplier stock history for {productId}
    </section>
  ),
}));

import ProductDetailPage from "./ProductDetailPage";
import type { Brand } from "./services/brandService";
import type { ProductDetail } from "./services/productService";

const activeBrand: Brand = {
  id: "brand-active",
  name: "ABB",
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  archivedAt: null,
};
const archivedBrand: Brand = {
  id: "brand-archived",
  name: "Legacy Brand",
  isActive: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  archivedAt: "2026-08-02T00:00:00.000Z",
};
const otherArchivedBrand: Brand = {
  ...archivedBrand,
  id: "brand-other-archived",
  name: "Other Archived Brand",
};
const activeProduct: ProductDetail = {
  id: "product-1",
  warehouseId: "10000000-0000-4000-8000-000000000001",
  warehouseCode: "raw_materials",
  quantity: 7,
  balanceUpdatedAt: "2026-09-02T12:00:00.000Z",
  serialNumber: "0000001",
  name: "Controller",
  category: "Control",
  brandId: "brand-active",
  brandName: "ABB",
  brandIsActive: true,
  productKind: "component",
  isActive: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T11:00:00.000Z",
  archivedAt: null,
};

function setHookState(options: {
  product?: ProductDetail;
  canEdit?: boolean;
  canArchive?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?:
    | { ok: true; value: ProductDetail }
    | { ok: false; error: { code: string; message: string } };
  brandsPending?: boolean;
  brandsError?: boolean;
  brandsData?:
    | { ok: true; value: Brand[] }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  detailPageMocks.useInventoryWarehouseAccess.mockReturnValue({
    profileId: "profile-1",
    authorizedWarehouses: [{
      id: "10000000-0000-4000-8000-000000000001",
      code: "raw_materials",
      label: "Raw Materials",
      viewPermission: "inventory.raw_materials.view",
      adjustPermission: "inventory.raw_materials.adjust",
    }],
    adjustableWarehouseIds: new Set(["10000000-0000-4000-8000-000000000001"]),
    canReadProjectAvailability: true,
    isPending: false,
    isError: false,
  });
  detailPageMocks.useInventoryLegacyViewPermission.mockReturnValue({
    canReadLegacyInventory: true,
    isPending: false,
  });
  detailPageMocks.useProductDetail.mockReturnValue({
    canEdit: options.canEdit ?? true,
    canArchive: options.canArchive ?? options.canEdit ?? true,
    productQuery: {
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      data: options.data ?? { ok: true, value: options.product ?? activeProduct },
      refetch: detailPageMocks.refetchProduct,
    },
    brandsQuery: {
      isPending: options.brandsPending ?? false,
      isError: options.brandsError ?? false,
      data: options.brandsData ?? {
        ok: true,
        value: [activeBrand, archivedBrand, otherArchivedBrand],
      },
      refetch: detailPageMocks.refetchBrands,
    },
    archive: detailPageMocks.archive,
    update: detailPageMocks.update,
  });
}

function renderDetail(path = "/inventory/product-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inventory/:productId" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  detailPageMocks.archive.mockResolvedValue({
    ok: true,
    value: { productId: "product-1" },
  });
  detailPageMocks.update.mockResolvedValue({
    ok: true,
    value: { productId: "product-1" },
  });
  setHookState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ProductDetailPage", () => {
  it.each(INVENTORY_WAREHOUSES)("wires minimum configuration to the selected $label balance card", warehouse => {
    detailPageMocks.useInventoryWarehouseAccess.mockReturnValue({
      ...detailPageMocks.useInventoryWarehouseAccess(), authorizedWarehouses: INVENTORY_WAREHOUSES,
    });
    renderDetail(`/inventory/product-1?warehouse=${warehouse.code}`);
    expect(detailPageMocks.stockHealth).toHaveBeenLastCalledWith({
      productId: activeProduct.id, serialNumber: activeProduct.serialNumber,
      productIsActive: true, warehouseId: warehouse.id,
    });
    expect(within(screen.getByRole("region", { name: "Product Inventory balance" }))
      .getByText("Warehouse minimum configuration")).toBeInTheDocument();
  });

  it("does not mount warehouse minimum configuration when warehouse access is denied", () => {
    detailPageMocks.useInventoryWarehouseAccess.mockReturnValue({
      ...detailPageMocks.useInventoryWarehouseAccess(), authorizedWarehouses: [],
    });
    renderDetail();
    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    expect(detailPageMocks.stockHealth).not.toHaveBeenCalled();
  });
  it("renders loading without exposing Product content", () => {
    setHookState({ isPending: true });
    renderDetail();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Product details...",
    );
    expect(screen.queryByText("Controller")).not.toBeInTheDocument();
  });

  it("renders safe read error/retry and a distinct not-found state", () => {
    setHookState({
      data: {
        ok: false,
        error: {
          code: "product_detail_failed",
          message: "The Product details could not be loaded.",
        },
      },
    });
    const rendered = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(detailPageMocks.refetchProduct).toHaveBeenCalledOnce();

    setHookState({
      data: {
        ok: false,
        error: {
          code: "product_not_found",
          message: "The Product could not be found.",
        },
      },
    });
    rendered.rerender(
      <MemoryRouter initialEntries={["/inventory/product-1"]}>
        <Routes>
          <Route path="/inventory/:productId" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Product not found");
    expect(screen.queryByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
  });

  it("shows Product master data, lifecycle dates, and nullable Brand safely", () => {
    setHookState({
      product: {
        ...activeProduct,
        brandId: null,
        brandName: null,
        brandIsActive: null,
      },
    });
    renderDetail();

    expect(screen.getByRole("heading", { name: "Controller" })).toBeInTheDocument();
    expect(screen.getAllByText("0000001")).toHaveLength(2);
    expect(screen.getByText("Control")).toBeInTheDocument();
    expect(screen.getByText("Not assigned")).toBeInTheDocument();
    expect(screen.getByText("Component")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Not archived")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Inventory" }))
      .toHaveAttribute("href", "/inventory?warehouse=raw_materials");
    expect(screen.getByRole("region", { name: "Product Inventory balance" }))
      .toHaveTextContent("Balance for product-1 — active");
  });

  it("keeps archived Products and their archived Brand readable but read-only", () => {
    setHookState({
      canEdit: false,
      product: {
        ...activeProduct,
        brandId: archivedBrand.id,
        brandName: archivedBrand.name,
        brandIsActive: false,
        isActive: false,
        archivedAt: "2026-09-03T12:00:00.000Z",
      },
    });
    renderDetail();

    expect(screen.getByText("Legacy Brand (archived)")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Product barcode" }))
      .toHaveTextContent("Barcode preview available");
    expect(screen.queryByRole("button", {
      name: /edit|archive|delete|restore|reactivate/i,
    })).not.toBeInTheDocument();
  });

  it("fails Edit visibility closed for view-only, pending, or failed permission state", () => {
    setHookState({ canEdit: false });
    renderDetail();

    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Product" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Product" }))
      .not.toBeInTheDocument();
  });

  it("requires archive confirmation and Cancel leaves the Product unchanged", () => {
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Archive Product" }));
    const dialog = screen.getByRole("dialog", { name: "Archive Product" });

    expect(dialog).toHaveTextContent("remain in historical records");
    expect(dialog).toHaveTextContent("removed from normal active use");
    expect(dialog).toHaveTextContent("reactivation is not supported");
    expect(detailPageMocks.archive).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Archive Product" }))
      .not.toBeInTheDocument();
    expect(detailPageMocks.archive).not.toHaveBeenCalled();
  });

  it("blocks duplicate archive submissions and reports successful archive", async () => {
    let resolveArchive: ((value: {
      ok: true;
      value: { productId: string };
    }) => void) | undefined;
    const pendingArchive = new Promise<{
      ok: true;
      value: { productId: string };
    }>((resolve) => {
      resolveArchive = resolve;
    });
    detailPageMocks.archive.mockReturnValue(pendingArchive);
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Archive Product" }));
    const dialog = screen.getByRole("dialog", { name: "Archive Product" });
    const confirm = within(dialog).getByRole("button", {
      name: "Archive Product",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(detailPageMocks.archive).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("button", { name: "Archive Product…" }))
      .toBeDisabled();

    resolveArchive?.({ ok: true, value: { productId: "product-1" } });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Product archived.",
    );
    expect(screen.queryByRole("dialog", { name: "Archive Product" }))
      .not.toBeInTheDocument();
  });

  it("prefills and validates editable master data without Serial or kind inputs", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Edit Product" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Product" });

    expect(within(dialog).getByLabelText("Name")).toHaveValue("Controller");
    expect(within(dialog).getByLabelText("Category")).toHaveValue("Control");
    expect(within(dialog).getByLabelText(/Brand/)).toHaveValue("brand-active");
    expect(within(dialog).queryByLabelText(/Serial/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Product kind/i)).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "   " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    expect(await within(dialog).findByText("Name is required."))
      .toBeInTheDocument();
    expect(detailPageMocks.update).not.toHaveBeenCalled();
  });

  it("offers active Brands and preserves only the Product's archived current Brand", () => {
    setHookState({
      product: {
        ...activeProduct,
        brandId: archivedBrand.id,
        brandName: archivedBrand.name,
        brandIsActive: false,
      },
    });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Edit Product" }));
    const brandSelect = screen.getByLabelText(/Brand/);

    expect(brandSelect).toHaveValue("brand-archived");
    expect(within(brandSelect).getByRole("option", { name: "ABB" }))
      .toBeInTheDocument();
    expect(within(brandSelect).getByRole("option", {
      name: "Legacy Brand (archived — current)",
    })).toBeInTheDocument();
    expect(within(brandSelect).queryByRole("option", {
      name: "Other Archived Brand",
    })).not.toBeInTheDocument();
  });

  it("submits normalized Product edits and shows success", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Edit Product" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Updated Controller  " },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "  Automation  " },
    });
    fireEvent.change(screen.getByLabelText(/Brand/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(detailPageMocks.update).toHaveBeenCalledWith({
      name: "Updated Controller",
      category: "Automation",
      brandId: null,
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Product updated.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks duplicate edit submissions while pending", async () => {
    let resolveUpdate: ((value: {
      ok: true;
      value: { productId: string };
    }) => void) | undefined;
    const pendingUpdate = new Promise<{
      ok: true;
      value: { productId: string };
    }>((resolve) => {
      resolveUpdate = resolve;
    });
    detailPageMocks.update.mockReturnValue(pendingUpdate);
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Edit Product" }));
    const submit = screen.getByRole("button", { name: "Save Changes" });

    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(detailPageMocks.update).toHaveBeenCalledOnce());
    expect(submit).toBeDisabled();
    resolveUpdate?.({ ok: true, value: { productId: "product-1" } });
    await pendingUpdate;
  });

  it("renders Product Supplier, Inventory history, and Barcode sections without later features", () => {
    renderDetail();

    expect(screen.getByRole("region", { name: "Product Supplier links" }))
      .toHaveTextContent("Suppliers for Controller (product-1) — active");
    expect(screen.getByRole("region", { name: "Product Inventory history" }))
      .toHaveTextContent("Inventory history for product-1");
    expect(screen.getByRole("region", { name: "Product barcode" }))
      .toHaveTextContent("Barcode preview available");
    expect(screen.queryByText(/quantity/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete|restore|reactivate/i }))
      .not.toBeInTheDocument();
  });
});
