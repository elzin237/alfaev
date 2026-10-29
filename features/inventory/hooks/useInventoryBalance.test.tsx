import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  adjustInventory: vi.fn(),
  getInventoryBalance: vi.fn(),
  transferInventory: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: hookMocks.useAuth,
}));
vi.mock("../services/inventoryBalanceService", () => ({
  adjustInventory: hookMocks.adjustInventory,
  getInventoryBalance: hookMocks.getInventoryBalance,
  transferInventory: hookMocks.transferInventory,
}));

import { useInventoryBalance } from "./useInventoryBalance";
const warehouseId = "10000000-0000-4000-8000-000000000001";

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
      warehouseId,
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
  hookMocks.transferInventory.mockResolvedValue({
    ok: true,
    value: {
      transferId: "transfer-1",
      sourceQuantityAfter: 7,
      destinationQuantityAfter: 3,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useInventoryBalance", () => {
  it.each(["adjust","transfer"] as const)("%s invalidates nested FG totals for only the acting profile",async operation=>{
    const {result,queryClient}=renderBalanceHook();
    const own=["inventory","commitments","profile-1","warehouse","finished_goods"];
    const foreign=["inventory","commitments","profile-2","warehouse","finished_goods"];
    queryClient.setQueryData(own,"old");queryClient.setQueryData(foreign,"private");
    await act(async()=>{
      if(operation==="adjust")await result.current.adjust({adjustmentType:"add",quantity:1,reason:"Delivery"});
      else await result.current.transfer({destinationWarehouseId:"customs",quantity:1,reason:"Transfer"});
    });
    expect(queryClient.getQueryState(own)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(foreign)?.isInvalidated).toBe(false);
  });
  it("uses a profile/Product-scoped balance query", async () => {
    const { result, queryClient } = renderBalanceHook();

    await waitFor(() => expect(result.current.balanceQuery.isSuccess).toBe(true));
    expect(queryClient.getQueryState([
      "inventory",
      "balances",
      "detail",
      "profile-1",
      warehouseId,
      "product-1",
    ])).toBeDefined();
    expect(hookMocks.getInventoryBalance).toHaveBeenCalledWith("product-1", warehouseId);
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

    expect(hookMocks.adjustInventory).toHaveBeenCalledWith("product-1", warehouseId, {
      adjustmentType: "add",
      quantity: 5,
      reason: "Delivery",
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(10);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "inventory",
        "balances",
        "detail",
        "profile-1",
        warehouseId,
        "product-1",
      ],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "products", "profile-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "commitments", "profile-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "movements", "product", "profile-1", warehouseId, "product-1"],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory-source-lots", "profile-1", warehouseId, "product-1"],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pcb", "cards", "profile-1"], exact: true });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pcb", "bom", "profile-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pcb", "bom-choices", "profile-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pcb", "production-source", "profile-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["inventory", "products", "detail", "profile-1", warehouseId, "product-1"], exact: true });
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

  it("invalidates both warehouse views after a trusted transfer without optimistic writes", async () => {
    const { result, queryClient } = renderBalanceHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const setQueryData = vi.spyOn(queryClient, "setQueryData");
    await waitFor(() => expect(result.current.balanceQuery.isSuccess).toBe(true));
    await act(async () => {
      await result.current.transfer({
        destinationWarehouseId: "10000000-0000-4000-8000-000000000002",
        quantity: 3,
        reason: "Rebalance",
      });
    });
    expect(hookMocks.transferInventory).toHaveBeenCalledWith(
      "product-1",
      warehouseId,
      {
        destinationWarehouseId: "10000000-0000-4000-8000-000000000002",
        quantity: 3,
        reason: "Rebalance",
      },
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(10);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pcb", "cards", "profile-1"], exact: true });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pcb", "bom", "profile-1"] });
    expect(setQueryData).not.toHaveBeenCalled();
  });

  it("refetches authoritative Calculator stock while leaving another profile's cache untouched", async () => {
    const { result, queryClient } = renderBalanceHook();
    await waitFor(() => expect(result.current.balanceQuery.isSuccess).toBe(true));
    const ownKey = ["pcb", "cards", "profile-1"] as const;
    const foreignKey = ["pcb", "cards", "profile-2"] as const;
    queryClient.setQueryData(ownKey, 0);
    queryClient.setQueryData(foreignKey, 99);
    await act(async () => { await result.current.transfer({ destinationWarehouseId: "customs", quantity: 1, reason: "Intake" }); });
    expect(queryClient.getQueryState(ownKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(foreignKey)?.isInvalidated).toBe(false);
    const readStock = vi.fn().mockResolvedValue(3);
    expect(await queryClient.fetchQuery({ queryKey: ownKey, queryFn: readStock })).toBe(3);
    expect(queryClient.getQueryData(foreignKey)).toBe(99);
  });

  it("does not invalidate or optimistically change stock after a failed transfer", async () => {
    hookMocks.transferInventory.mockResolvedValue({ ok: false, error: { code: "access_denied", message: "safe" } });
    const { result, queryClient } = renderBalanceHook();
    await waitFor(() => expect(result.current.balanceQuery.isSuccess).toBe(true));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.transfer({ destinationWarehouseId: "customs", quantity: 1, reason: "Intake" }); });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
// Existing invalidation contract with the optional Low Stock release disabled.
// Its enabled scoped invalidation is covered by useInventoryStockHealth tests.
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:()=>false}));
