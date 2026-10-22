import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const historyMocks = vi.hoisted(() => ({
  useInventoryMovements: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("../hooks/useInventoryMovements", () => ({
  useInventoryMovements: historyMocks.useInventoryMovements,
}));

import InventoryHistorySection from "./InventoryHistorySection";
import type { InventoryMovement } from "../services/inventoryMovementService";

const movements: InventoryMovement[] = [
  {
    movementId: "movement-new",
    createdAt: "2026-09-14T12:00:00.000Z",
    movementType: "manual_remove",
    quantityDelta: -3,
    quantityBefore: 10,
    quantityAfter: 7,
    reason: "Issued to workshop",
    sourceType: "manual_adjustment",
    sourceId: "source-1",
    projectId: null,
    reversalOfMovementId: null,
    actorUserId: "profile-1",
    actorFullName: "Alfa Admin",
  },
  {
    movementId: "movement-old",
    createdAt: "2026-09-14T10:00:00.000Z",
    movementType: "manual_add",
    quantityDelta: 10,
    quantityBefore: 0,
    quantityAfter: 10,
    reason: null,
    sourceType: null,
    sourceId: null,
    projectId: null,
    reversalOfMovementId: null,
    actorUserId: "profile-1",
    actorFullName: "Alfa Admin",
  },
];

function setQueryState(options: {
  isPending?: boolean;
  isError?: boolean;
  data?:
    | { ok: true; value: InventoryMovement[] }
    | { ok: false; error: { code: string; message: string } };
} = {}) {
  historyMocks.useInventoryMovements.mockReturnValue({
    isPending: options.isPending ?? false,
    isError: options.isError ?? false,
    data: options.data ?? { ok: true, value: movements },
    refetch: historyMocks.refetch,
  });
}

beforeEach(() => setQueryState());

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("InventoryHistorySection", () => {
  it("renders loading, safe error with retry, and empty states", () => {
    setQueryState({ isPending: true });
    const rendered = render(<InventoryHistorySection productId="product-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Inventory history...",
    );

    setQueryState({
      data: {
        ok: false,
        error: {
          code: "inventory_history_load_failed",
          message: "The Inventory history could not be loaded.",
        },
      },
    });
    rendered.rerender(<InventoryHistorySection productId="product-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(historyMocks.refetch).toHaveBeenCalledOnce();

    setQueryState({ data: { ok: true, value: [] } });
    rendered.rerender(<InventoryHistorySection productId="product-1" />);
    expect(screen.getByRole("heading", { name: "No Inventory movements" }))
      .toBeInTheDocument();
  });

  it("shows signed ledger data, actor name, nullable context, and preserves newest-first order", () => {
    render(<InventoryHistorySection productId="product-archived" />);

    for (const heading of [
      "Date",
      "Type / Source",
      "Delta",
      "Before",
      "After",
      "User",
      "Reason / Context",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading }))
        .toBeInTheDocument();
    }

    const rows = screen.getAllByRole("row");
    const removeRow = screen.getByRole("row", {
      name: /Manual removeManual adjustment -3 10 7 Alfa Admin Issued to workshop/,
    });
    const addRow = screen.getByRole("row", {
      name: /Manual addNo source \+10 0 10 Alfa Admin —/,
    });
    expect(rows.indexOf(removeRow)).toBeLessThan(rows.indexOf(addRow));
    expect(within(removeRow).getByText("-3")).toBeInTheDocument();
    expect(within(addRow).getByText("+10")).toBeInTheDocument();
    expect(within(addRow).getByText("—")).toBeInTheDocument();
    expect(historyMocks.useInventoryMovements)
      .toHaveBeenCalledWith(
        "product-archived", "10000000-0000-4000-8000-000000000001",
      );
    expect(screen.queryByRole("button", {
      name: /update|delete|reverse|adjust/i,
    })).not.toBeInTheDocument();
  });
});
