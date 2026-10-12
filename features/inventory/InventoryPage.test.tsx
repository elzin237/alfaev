import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const inventoryMocks = vi.hoisted(() => ({
  useBrandManagement: vi.fn(),
  useProductCreation: vi.fn(),
  useComponentImport: vi.fn(),
  useProducts: vi.fn(),
  useInventoryCommitments: vi.fn(),
  refetch: vi.fn(),
  productRefetch: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  createProduct: vi.fn(),
  importBatch: vi.fn(),
}));

vi.mock("./hooks/useBrandManagement", () => ({
  useBrandManagement: inventoryMocks.useBrandManagement,
}));
vi.mock("./hooks/useProductCreation", () => ({
  useProductCreation: inventoryMocks.useProductCreation,
}));
vi.mock("./hooks/useComponentImport", () => ({
  useComponentImport: inventoryMocks.useComponentImport,
}));
vi.mock("./hooks/useProducts", () => ({
  useProducts: inventoryMocks.useProducts,
}));
vi.mock("./hooks/useInventoryCommitments", () => ({
  useInventoryCommitments: inventoryMocks.useInventoryCommitments,
}));
vi.mock("./components/ComponentImportDialog", () => ({
  default: ({
    open,
    onSucceeded,
  }: {
    open: boolean;
    onSucceeded: (result: { createdCount: number }) => void;
  }) => open ? (
    <div role="dialog" aria-label="Import Components from Excel">
      <button type="button" onClick={() => onSucceeded({ createdCount: 2 })}>
        Complete import
      </button>
    </div>
  ) : null,
}));

import InventoryPage from "./InventoryPage";
import type { Brand } from "./services/brandService";
import type { ProductListItem, ProductListResult } from "./services/productService";

const activeBrand: Brand = {
  id: "brand-active",
  name: "ABB",
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  archivedAt: null,
};

const archivedBrand: Brand = {
  id: "brand-archived",
  name: "Bosch",
  isActive: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  archivedAt: "2026-08-02T00:00:00.000Z",
};

const activeProduct: ProductListItem = {
  id: "product-active",
  serialNumber: "0000001",
  name: "Resistor",
  category: "Passive",
  brandName: null,
  productKind: "component",
  isActive: true,
  quantity: 0,
};

const archivedProduct: ProductListItem = {
  id: "product-archived",
  serialNumber: "0000002",
  name: "Legacy Controller",
  category: "Control",
  brandName: "Bosch",
  productKind: "pcb_finished_good",
  isActive: false,
  quantity: 27,
};

function setHookState(options: {
  canManage?: boolean;
  canCreate?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?: { ok: true; value: Brand[] } | { ok: false; error: { code: string; message: string } };
  productsPending?: boolean;
  productsError?: boolean;
  productsData?: ProductListResult;
} = {}) {
  inventoryMocks.useInventoryCommitments.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, value: [
      { productId: "product-active", physicalQuantity: 0n, committedToProjects: 0n, availableAfterCommitments: 0n },
      { productId: "product-archived", physicalQuantity: 27n, committedToProjects: 0n, availableAfterCommitments: 27n },
    ] },
    refetch: vi.fn(),
  });
  inventoryMocks.useBrandManagement.mockReturnValue({
    canManage: options.canManage ?? true,
    brandsQuery: {
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      data: options.data ?? { ok: true, value: [activeBrand, archivedBrand] },
      refetch: inventoryMocks.refetch,
    },
    create: inventoryMocks.create,
    update: inventoryMocks.update,
    archive: inventoryMocks.archive,
  });
  inventoryMocks.useProductCreation.mockReturnValue({
    canCreate: options.canCreate ?? true,
    create: inventoryMocks.createProduct,
  });
  inventoryMocks.useComponentImport.mockReturnValue({
    importBatch: inventoryMocks.importBatch,
  });
  inventoryMocks.useProducts.mockReturnValue({
    isPending: options.productsPending ?? false,
    isError: options.productsError ?? false,
    data: options.productsData ?? { ok: true, value: [] },
    refetch: inventoryMocks.productRefetch,
  });
}

function renderInventory() {
  return render(
    <MemoryRouter>
      <InventoryPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  inventoryMocks.create.mockResolvedValue({
    ok: true,
    value: { brandId: "brand-new" },
  });
  inventoryMocks.update.mockResolvedValue({
    ok: true,
    value: { brandId: "brand-active" },
  });
  inventoryMocks.archive.mockResolvedValue({
    ok: true,
    value: { brandId: "brand-active" },
  });
  inventoryMocks.createProduct.mockResolvedValue({
    ok: true,
    value: { productId: "product-new", serialNumber: "0000123" },
  });
  inventoryMocks.importBatch.mockResolvedValue({
    ok: true,
    value: { createdCount: 2, products: [] },
  });
  setHookState();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("InventoryPage", () => {
  it("keeps physical stock visible and never fakes commitment zero after a read failure", () => {
    setHookState({ productsData: { ok: true, value: [activeProduct] } });
    const retry = vi.fn();
    inventoryMocks.useInventoryCommitments.mockReturnValue({
      isPending: false, isError: false,
      data: { ok: false, error: { code: "load_failed", message: "Safe error" } },
      refetch: retry,
    });
    renderInventory();
    expect(screen.getByRole("alert")).toHaveTextContent("Project commitment figures are unavailable");
    const row = screen.getByRole("row", { name: /0000001 Resistor Passive/ });
    expect(within(row).getAllByText("Unavailable")).toHaveLength(2);
    expect(within(row).getByText("0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders loading, safe error with retry, and empty states", () => {
    setHookState({ isPending: true });
    const rendered = renderInventory();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Brands...");

    setHookState({
      data: {
        ok: false,
        error: { code: "brand_list_failed", message: "The Brand list could not be loaded." },
      },
    });
    rendered.rerender(<MemoryRouter><InventoryPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("The Brand list could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(inventoryMocks.refetch).toHaveBeenCalledOnce();

    setHookState({ data: { ok: true, value: [] }, canManage: false });
    rendered.rerender(<MemoryRouter><InventoryPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "No Brands found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Brand" })).not.toBeInTheDocument();
  });

  it("shows real active and archived rows in deterministic service order", () => {
    renderInventory();
    const rows = screen.getAllByRole("row");
    const activeRow = screen.getByRole("row", { name: /ABB Active/ });
    const archivedRow = screen.getByRole("row", { name: /Bosch Archived/ });

    expect(rows.indexOf(activeRow)).toBeLessThan(rows.indexOf(archivedRow));
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
  });

  it("renders Product loading, safe error with retry, and empty states", () => {
    setHookState({ productsPending: true });
    const rendered = renderInventory();
    expect(screen.getByText("Loading Products...")).toBeInTheDocument();

    setHookState({
      productsData: {
        ok: false,
        error: {
          code: "product_list_failed",
          message: "The Product list could not be loaded.",
        },
      },
    });
    rendered.rerender(<MemoryRouter><InventoryPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Product list could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(inventoryMocks.productRefetch).toHaveBeenCalledOnce();

    setHookState({ productsData: { ok: true, value: [] }, canCreate: false });
    rendered.rerender(<MemoryRouter><InventoryPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "No Products found" }))
      .toBeInTheDocument();
  });

  it("shows Products before Brands, including nullable and archived Brand history", () => {
    setHookState({
      productsData: { ok: true, value: [activeProduct, archivedProduct] },
    });
    renderInventory();

    const productsHeading = screen.getByRole("heading", { name: "Products" });
    const brandsHeading = screen.getByRole("heading", { name: "Brands" });
    expect(
      productsHeading.compareDocumentPosition(brandsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const activeRow = screen.getByRole("row", {
      name: /0000001 Resistor Passive — 0 0 0 Active/,
    });
    const archivedRow = screen.getByRole("row", {
      name: /0000002 Legacy Controller Control Bosch 27 0 27 Archived/,
    });
    expect(within(activeRow).getByText("—")).toBeInTheDocument();
    expect(within(activeRow).getAllByText("0").length).toBeGreaterThan(0);
    expect(within(archivedRow).getByText("Bosch")).toBeInTheDocument();
    expect(within(archivedRow).getAllByText("27").length).toBeGreaterThan(0);
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Physical Quantity")).toBeInTheDocument();
    expect(screen.getByText("Committed to Projects")).toBeInTheDocument();
    expect(screen.getByText("Available after Commitments")).toBeInTheDocument();
  });

  it("debounces server-backed Product search and distinguishes no matches from an empty Inventory", () => {
    vi.useFakeTimers();
    setHookState({ productsData: { ok: true, value: [] }, canCreate: false });
    renderInventory();

    const search = screen.getByRole("searchbox", { name: "Search Products" });
    expect(search).toHaveAttribute(
      "placeholder",
      "Name, Category, Serial Number / Šifra, or Catalog Number",
    );
    expect(inventoryMocks.useProducts).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("heading", { name: "No Products found" }))
      .toBeInTheDocument();

    fireEvent.change(search, { target: { value: "  res" } });
    fireEvent.change(search, { target: { value: "  resistor  " } });
    expect(inventoryMocks.useProducts).toHaveBeenLastCalledWith("");

    act(() => vi.advanceTimersByTime(299));
    expect(inventoryMocks.useProducts).toHaveBeenLastCalledWith("");

    act(() => vi.advanceTimersByTime(1));
    expect(inventoryMocks.useProducts).toHaveBeenLastCalledWith("resistor");
    expect(screen.getByRole("heading", { name: "No matching Products" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear Search" }));
    expect(search).toHaveValue("");
    expect(inventoryMocks.useProducts).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("heading", { name: "No Products found" }))
      .toBeInTheDocument();
  });

  it("hides every management action for an Inventory view-only user", () => {
    setHookState({ canManage: false, canCreate: false });
    renderInventory();

    expect(screen.getByText("ABB")).toBeInTheDocument();
    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Brand" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Component" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import Excel" }))
      .not.toBeInTheDocument();
  });

  it("shows Import Excel before Add Component and opens the import dialog", () => {
    renderInventory();
    const pageHeader = screen.getByRole("heading", { name: "Inventory" }).closest("header");
    if (!pageHeader) throw new Error("Inventory PageHeader was not rendered.");
    const importButton = within(pageHeader).getByRole("button", { name: "Import Excel" });
    const addButton = within(pageHeader).getByRole("button", { name: "Add Component" });
    expect(importButton.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    fireEvent.click(importButton);
    expect(screen.getByRole("dialog", { name: "Import Components from Excel" }))
      .toBeInTheDocument();
  });

  it("shows authoritative imported count after successful import", () => {
    renderInventory();
    fireEvent.click(screen.getByRole("button", { name: "Import Excel" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete import" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 Components imported successfully.",
    );
  });

  it("creates a Component with an active optional Brand and shows its generated Serial", async () => {
    renderInventory();

    const pageHeader = screen.getByRole("heading", { name: "Inventory" })
      .closest("header");
    if (!pageHeader) throw new Error("Inventory PageHeader was not rendered.");
    fireEvent.click(
      within(pageHeader).getByRole("button", { name: "Add Component" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add Component" });
    const brandSelect = within(dialog).getByLabelText(/Brand/);

    expect(within(brandSelect).getByRole("option", { name: "ABB" }))
      .toBeInTheDocument();
    expect(within(brandSelect).queryByRole("option", { name: "Bosch" }))
      .not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "  Resistor  " },
    });
    fireEvent.change(within(dialog).getByLabelText("Category"), {
      target: { value: "  Passive  " },
    });
    fireEvent.change(brandSelect, { target: { value: "brand-active" } });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Add Component",
    }));

    await waitFor(() => expect(inventoryMocks.createProduct).toHaveBeenCalledWith({
      name: "Resistor",
      category: "Passive",
      brandId: "brand-active",
    }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Component created. Serial Number: 0000123",
    );
    expect(screen.queryByRole("dialog", { name: "Add Component" }))
      .not.toBeInTheDocument();
  });

  it("shows Add/Edit/Archive to managers, but no archived or destructive actions", () => {
    renderInventory();

    expect(screen.getByRole("button", { name: "Add Brand" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /delete|restore|reactivate/i })).not.toBeInTheDocument();
  });

  it("adds and edits through focused dialogs with success feedback", async () => {
    renderInventory();

    fireEvent.click(screen.getByRole("button", { name: "Add Brand" }));
    fireEvent.change(screen.getByLabelText("Brand Name"), {
      target: { value: " Siemens " },
    });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Add Brand" })).getByRole(
        "button",
        { name: "Add Brand" },
      ),
    );
    await waitFor(() => expect(inventoryMocks.create).toHaveBeenCalledWith("Siemens"));
    expect(await screen.findByText("Brand added.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Brand Name")).toHaveValue("ABB");
    fireEvent.change(screen.getByLabelText("Brand Name"), {
      target: { value: "ABB Motion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(inventoryMocks.update).toHaveBeenCalledWith("brand-active", "ABB Motion"));
    expect(await screen.findByText("Brand updated.")).toBeInTheDocument();
  });

  it("requires archive confirmation and describes all locked consequences", async () => {
    renderInventory();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(inventoryMocks.archive).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Archive Brand" });
    expect(dialog).toHaveTextContent("remain in historical records");
    expect(dialog).toHaveTextContent("cannot be used for new Products");
    expect(dialog).toHaveTextContent("reactivation is not currently supported");

    fireEvent.click(within(dialog).getByRole("button", { name: "Archive Brand" }));
    await waitFor(() => expect(inventoryMocks.archive).toHaveBeenCalledWith("brand-active"));
    expect(await screen.findByText("Brand archived.")).toBeInTheDocument();
  });
});
