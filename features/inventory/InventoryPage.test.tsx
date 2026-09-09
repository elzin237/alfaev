import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inventoryMocks = vi.hoisted(() => ({
  useBrandManagement: vi.fn(),
  useProductCreation: vi.fn(),
  refetch: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  createProduct: vi.fn(),
}));

vi.mock("./hooks/useBrandManagement", () => ({
  useBrandManagement: inventoryMocks.useBrandManagement,
}));
vi.mock("./hooks/useProductCreation", () => ({
  useProductCreation: inventoryMocks.useProductCreation,
}));

import InventoryPage from "./InventoryPage";
import type { Brand } from "./services/brandService";

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

function setHookState(options: {
  canManage?: boolean;
  canCreate?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?: { ok: true; value: Brand[] } | { ok: false; error: { code: string; message: string } };
} = {}) {
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
  setHookState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("InventoryPage", () => {
  it("renders loading, safe error with retry, and empty states", () => {
    setHookState({ isPending: true });
    const rendered = render(<InventoryPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Brands...");

    setHookState({
      data: {
        ok: false,
        error: { code: "brand_list_failed", message: "The Brand list could not be loaded." },
      },
    });
    rendered.rerender(<InventoryPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("The Brand list could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(inventoryMocks.refetch).toHaveBeenCalledOnce();

    setHookState({ data: { ok: true, value: [] }, canManage: false });
    rendered.rerender(<InventoryPage />);
    expect(screen.getByRole("heading", { name: "No Brands found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Brand" })).not.toBeInTheDocument();
  });

  it("shows real active and archived rows in deterministic service order", () => {
    render(<InventoryPage />);
    const rows = screen.getAllByRole("row");
    const activeRow = screen.getByRole("row", { name: /ABB Active/ });
    const archivedRow = screen.getByRole("row", { name: /Bosch Archived/ });

    expect(rows.indexOf(activeRow)).toBeLessThan(rows.indexOf(archivedRow));
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();
    expect(within(archivedRow).getByText("Archived")).toBeInTheDocument();
  });

  it("hides every management action for an Inventory view-only user", () => {
    setHookState({ canManage: false, canCreate: false });
    render(<InventoryPage />);

    expect(screen.getByText("ABB")).toBeInTheDocument();
    expect(screen.getByText("Bosch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Brand" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Component" }))
      .not.toBeInTheDocument();
  });

  it("creates a Component with an active optional Brand and shows its generated Serial", async () => {
    render(<InventoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add Component" }));
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
    render(<InventoryPage />);

    expect(screen.getByRole("button", { name: "Add Brand" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /delete|restore|reactivate/i })).not.toBeInTheDocument();
  });

  it("adds and edits through focused dialogs with success feedback", async () => {
    render(<InventoryPage />);

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
    render(<InventoryPage />);

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
