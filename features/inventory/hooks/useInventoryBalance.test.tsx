import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  adjustInventory: vi.fn(),
  getInventoryBalance: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: hookMocks.useAuth,
}));
vi.mock("../services/inventoryBalanceService", () => ({
  adjustInventory: hookMocks.adjustInventory,
  getInventoryBalance: hookMocks.getInventoryBalance,
}));

import { useInventoryBalance } from "./useInventoryBalance";

function renderBalanceHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useInventoryBalance("product-1"), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  hookMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  hookMocks.getInventoryBalance.mockResolvedValue({
    ok: true,
    value: {
      productId: "product-1",
      quantity: 10,
      updatedAt: "2026-09-14T10:00:00.000Z",
    },
  });
  hookMocks.adjustInventory.mockResolvedValue({
    ok: true,
    value: {
      movementId: "movement-1",
      quantityBefore: 10,
      quantityAfter: 15,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useInventoryBalance", () => {
  it("uses a profile/Product-scoped balance query", async () => {
    const { result, queryClient } = renderBalanceHook();

    await waitFor(() => expect(result.current.balanceQuery.isSuccess).toBe(true));
    expect(queryClient.getQueryState([
      "inventory",
      "balances",
      "detail",
      "profile-1",
      "product-1",
    ])).toBeDefined();
    expect(hookMocks.getInventoryBalance).toHaveBeenCalledWith("product-1");
  });

  it("invalidates balance, history, provenance, commitments, and Product list after adjustment", async () => {
    const { result, queryClient } = renderBalanceHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.balanceQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.adjust({
        adjustmentType: "add",
        quantity: 5,
        reason: "Delivery",
      });
    });

    expect(hookMocks.adjustInventory).toHaveBeenCalledWith("product-1", {
      adjustmentType: "add",
      quantity: 5,
      reason: "Delivery",
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(5);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "inventory",
        "balances",
        "detail",
        "profile-1",
        "product-1",
      ],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "products", "profile-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "commitments", "profile-1"], exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "movements", "product", "profile-1", "product-1"],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory-source-lots", "profile-1", "product-1"],
      exact: true,
    });
  });

  it("does not invalidate after failed adjustment", async () => {
    hookMocks.adjustInventory.mockResolvedValue({
      ok: false,
      error: { code: "adjustment_invalid", message: "safe" },
    });
    const { result, queryClient } = renderBalanceHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.balanceQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.adjust({
        adjustmentType: "add",
        quantity: 0,
        reason: "Invalid",
      });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
