import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), hasPermission: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));

import { useInventoryWarehouseAccess } from "./useInventoryWarehouseAccess";

function renderAccess() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(useInventoryWarehouseAccess, { wrapper });
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("useInventoryWarehouseAccess", () => {
  it("gives Admins all three warehouses without permission lookups", () => {
    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true },
      isAdmin: true,
    });
    const { result } = renderAccess();
    expect(result.current.authorizedWarehouses.map((warehouse) => warehouse.label))
      .toEqual(["Raw Materials", "Finished Goods", "Customs Warehouse"]);
    expect(result.current.adjustableWarehouseIds.size).toBe(3);
    expect(result.current.canReadProjectAvailability).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("exposes only independently granted views and adjustments", async () => {
    mocks.hasPermission.mockImplementation(async (permission: string) => ({
      ok: true,
      value: permission === "inventory.finished_goods.view" ||
        permission === "inventory.finished_goods.adjust",
    }));
    const { result } = renderAccess();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.authorizedWarehouses.map((warehouse) => warehouse.code))
      .toEqual(["finished_goods"]);
    expect([...result.current.adjustableWarehouseIds])
      .toEqual(["10000000-0000-4000-8000-000000000002"]);
    expect(result.current.canReadProjectAvailability).toBe(false);
    expect(mocks.hasPermission).toHaveBeenCalledTimes(6);
  });

  it("fails closed with no authorized warehouse", async () => {
    mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
    const { result } = renderAccess();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.authorizedWarehouses).toEqual([]);
    expect(result.current.adjustableWarehouseIds.size).toBe(0);
    expect(result.current.canReadProjectAvailability).toBe(false);
  });

  it("allows combined Project availability only with both eligible warehouse views", async () => {
    mocks.hasPermission.mockImplementation(async (permission: string) => ({
      ok: true,
      value: permission === "inventory.raw_materials.view" ||
        permission === "inventory.customs.view",
    }));
    const { result } = renderAccess();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.authorizedWarehouses.map((warehouse) => warehouse.code))
      .toEqual(["raw_materials", "customs"]);
    expect(result.current.canReadProjectAvailability).toBe(true);
  });
});
