import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sectionMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useInventoryBalance: vi.fn(),
  useInventoryCommitments: vi.fn(),
  useProductProjectCommitments: vi.fn(),
  useInventorySourceChoices: vi.fn(),
  refetch: vi.fn(),
  adjust: vi.fn(),
  transfer: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: sectionMocks.useAuth,
}));
vi.mock("../hooks/useInventoryBalance", () => ({
  useInventoryBalance: sectionMocks.useInventoryBalance,
}));
vi.mock("../hooks/useInventoryCommitments", () => ({
  useInventoryCommitments: sectionMocks.useInventoryCommitments,
  useProductProjectCommitments: sectionMocks.useProductProjectCommitments,
}));
vi.mock("../hooks/useInventorySources", () => ({
  useInventorySourceChoices: sectionMocks.useInventorySourceChoices,
}));

import InventoryBalanceSection from "./InventoryBalanceSection";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";

function setSectionState(options: {
  isAdmin?: boolean;
  isPending?: boolean;
  isError?: boolean;
  data?:
    | { ok: true; value: { productId: string; quantity: number; updatedAt: string } }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  const defaultData = {
    ok: true as const,
    value: {
      productId: "product-1",
      quantity: 10,
      updatedAt: "2026-09-14T10:00:00.000Z",
    },
  };
  sectionMocks.useAuth.mockReturnValue({ isAdmin: options.isAdmin ?? true });
  sectionMocks.useInventoryCommitments.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, value: [{ productId: "product-1", physicalQuantity: 10n, committedToProjects: 0n, availableAfterCommitments: 10n }] },
    refetch: vi.fn(),
  });
  sectionMocks.useProductProjectCommitments.mockReturnValue({ isPending: false, isError: false, data: { ok: true, value: [] }, refetch: vi.fn() });
  sectionMocks.useInventorySourceChoices.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, value: [{
      productSupplierId: "relation-1",
      supplierId: "supplier-1",
      supplierName: "ABB",
      catalogNumber: "CAT-1",
      description: null,
    }] },
    refetch: vi.fn(),
  });
  sectionMocks.useInventoryBalance.mockReturnValue({
    balanceQuery: {
      isPending: options.isPending ?? false,
      isError: options.isError ?? false,
      data: options.data ?? (options.isPending ? undefined : defaultData),
      refetch: sectionMocks.refetch,
    },
    adjust: sectionMocks.adjust,
    transfer: sectionMocks.transfer,
  });
}

beforeEach(() => {
  sectionMocks.transfer.mockResolvedValue({ ok: true, value: { transferId: "first-customs", sourceQuantityAfter: 8, destinationQuantityAfter: 2 } });
  sectionMocks.adjust.mockResolvedValue({
    ok: true,
    value: { movementId: "movement-1", quantityBefore: 10, quantityAfter: 11 },
  });
  setSectionState();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("InventoryBalanceSection", () => {
  it("starts first Customs intake from authorized Raw Product detail without requiring Customs list membership", async () => {
    setSectionState({ isAdmin: false });
    render(<InventoryBalanceSection productId="product-1" productIsActive
      warehouse={INVENTORY_WAREHOUSES[0]!} canAdjust
      transferDestinations={[INVENTORY_WAREHOUSES[2]!]} canReadCommitments={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(screen.getByRole("combobox", { name: "Destination warehouse" })).toHaveValue(INVENTORY_WAREHOUSES[2]!.id);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "First Customs intake" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer Inventory" }));
    await waitFor(() => expect(sectionMocks.transfer).toHaveBeenCalledExactlyOnceWith({
      destinationWarehouseId: INVENTORY_WAREHOUSES[2]!.id, quantity: 2, reason: "First Customs intake",
    }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sectionMocks.useInventoryBalance).toHaveBeenCalledWith("product-1", INVENTORY_WAREHOUSES[0]!.id);
  });

  it("shows signed availability, shortage, and fetches Project attribution only when opened", () => {
    sectionMocks.useInventoryCommitments.mockReturnValue({
      isPending: false, isError: false,
      data: { ok: true, value: [{ productId: "product-1", physicalQuantity: 10n, committedToProjects: 15n, availableAfterCommitments: -5n }] },
      refetch: vi.fn(),
    });
    sectionMocks.useProductProjectCommitments.mockReturnValue({
      isPending: false, isError: false,
      data: { ok: true, value: [{ projectId: "project-1", projectName: "Build A", plannedRequirement: 20n, actualProjectConsumption: 5n, outstandingCommitment: 15n }] },
      refetch: vi.fn(),
    });
    render(<InventoryBalanceSection productId="product-1" productIsActive />);
    expect(screen.getByText("Eligible Stock (Raw + Customs)")).toBeInTheDocument();
    expect(screen.getByText("Raw Physical Quantity")).toBeInTheDocument();
    expect(screen.getByText("Outstanding Project Demand")).toBeInTheDocument();
    expect(screen.getByText("Available After Demand (Raw + Customs)")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Shortage");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "eligible Raw Materials and Customs stock",
    );
    expect(screen.queryByText("Build A")).not.toBeInTheDocument();
    expect(sectionMocks.useProductProjectCommitments).toHaveBeenCalledWith("product-1", false, true);
    fireEvent.click(screen.getByRole("button", { name: "View Project commitments" }));
    expect(sectionMocks.useProductProjectCommitments).toHaveBeenCalledWith("product-1", true, true);
    expect(screen.getByText("Build A")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Outstanding" })).toBeInTheDocument();
  });

  it("shows current balance and the action only to Admins with an active Product", () => {
    const rendered = render(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.getAllByText("10").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Adjust Inventory" }))
      .toBeEnabled();

    setSectionState({ isAdmin: false });
    rendered.rerender(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.queryByRole("button", { name: "Adjust Inventory" }))
      .not.toBeInTheDocument();

    setSectionState({ isAdmin: true });
    rendered.rerender(
      <InventoryBalanceSection productId="product-1" productIsActive={false} />,
    );
    expect(screen.getAllByText("10").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Adjust Inventory" }))
      .not.toBeInTheDocument();
  });

  it("renders balance loading and safe retryable error states", () => {
    setSectionState({ isPending: true });
    const rendered = render(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Inventory balance...",
    );
    expect(screen.getByRole("button", { name: "Adjust Inventory" }))
      .toBeDisabled();

    setSectionState({
      data: {
        ok: false,
        error: {
          code: "inventory_balance_load_failed",
          message: "The Inventory balance could not be loaded.",
        },
      },
    });
    rendered.rerender(
      <InventoryBalanceSection productId="product-1" productIsActive />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The Inventory balance could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sectionMocks.refetch).toHaveBeenCalledOnce();
  });

  it("opens the focused dialog only after balance data is available", () => {
    render(<InventoryBalanceSection productId="product-1" productIsActive />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust Inventory" }));

    expect(screen.getByRole("dialog", { name: "Adjust Inventory" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("10").length).toBeGreaterThan(1);
    expect(sectionMocks.useInventoryBalance).toHaveBeenCalledWith(
      "product-1", "10000000-0000-4000-8000-000000000001",
    );
  });
});
