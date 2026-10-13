import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useInventorySourceLots: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("../hooks/useInventorySources", () => ({
  useInventorySourceLots: mocks.useInventorySourceLots,
}));

import SupplierStockHistorySection from "./SupplierStockHistorySection";

beforeEach(() => {
  mocks.useInventorySourceLots.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      ok: true,
      value: [
        {
          id: "lot-1",
          sourceKind: "supplier",
          receivedAt: "2026-10-13T08:00:00.000Z",
          supplierName: "IBP",
          catalogNumber: "CAT-100",
          description: "Control relay",
          receivedQuantity: 9_223_372_036_854_775_807n,
          remainingQuantity: 40n,
          addedBy: "Ada Lovelace",
        },
        {
          id: "lot-2",
          sourceKind: "legacy_unknown",
          receivedAt: "2026-10-13T09:00:00.000Z",
          supplierName: "Legacy / Unknown",
          catalogNumber: null,
          description: null,
          receivedQuantity: 5n,
          remainingQuantity: 0n,
          addedBy: null,
        },
      ],
    },
    refetch: mocks.refetch,
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SupplierStockHistorySection", () => {
  it("renders immutable snapshot columns, exact quantities, and truthful legacy source", () => {
    render(<SupplierStockHistorySection productId="product-1" />);

    for (const heading of [
      "Date",
      "Supplier",
      "Catalog Number",
      "Description",
      "Received Quantity",
      "Remaining Quantity",
      "Added By",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    const supplierRow = screen.getByText("IBP").closest("tr");
    expect(supplierRow).not.toBeNull();
    expect(supplierRow).toHaveTextContent("CAT-100");
    expect(supplierRow).toHaveTextContent("Control relay");
    expect(supplierRow).toHaveTextContent("9223372036854775807");
    expect(supplierRow).toHaveTextContent("Ada Lovelace");

    const legacyRow = screen.getByText("Legacy / Unknown").closest("tr");
    expect(legacyRow).not.toBeNull();
    expect(within(legacyRow as HTMLElement).getAllByText("—")).toHaveLength(3);
  });

  it("keeps loading, error/retry, and truly empty states distinct", () => {
    mocks.useInventorySourceLots.mockReturnValue({ isPending: true });
    const rendered = render(<SupplierStockHistorySection productId="product-1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Supplier Stock History");

    mocks.useInventorySourceLots.mockReturnValue({
      isPending: false,
      isError: true,
      data: { ok: false, error: { message: "Safe history failure." } },
      refetch: mocks.refetch,
    });
    rendered.rerender(<SupplierStockHistorySection productId="product-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Safe history failure.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();

    mocks.useInventorySourceLots.mockReturnValue({
      isPending: false,
      isError: false,
      data: { ok: true, value: [] },
      refetch: mocks.refetch,
    });
    rendered.rerender(<SupplierStockHistorySection productId="product-1" />);
    expect(screen.getByRole("heading", { name: "No source lots" })).toBeInTheDocument();
  });
});
