import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  listActiveProductChoices: vi.fn(),
  listSupplierProducts: vi.fn(),
  createProductSupplier: vi.fn(),
  updateProductSupplier: vi.fn(),
  archiveProductSupplier: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: hookMocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: hookMocks.hasPermission,
}));
vi.mock("../../inventory/services/productSupplierService", () => ({
  listActiveProductChoices: hookMocks.listActiveProductChoices,
  listSupplierProducts: hookMocks.listSupplierProducts,
  createProductSupplier: hookMocks.createProductSupplier,
  updateProductSupplier: hookMocks.updateProductSupplier,
  archiveProductSupplier: hookMocks.archiveProductSupplier,
}));

import { useSupplierProducts } from "./useSupplierProducts";

function renderSupplierProductsHook(supplierIsActive = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(
      () => useSupplierProducts("supplier-1", supplierIsActive),
      { wrapper },
    ),
    queryClient,
  };
}

beforeEach(() => {
  hookMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  hookMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  hookMocks.listActiveProductChoices.mockResolvedValue({ ok: true, value: [] });
  hookMocks.listSupplierProducts.mockResolvedValue({ ok: true, value: [] });
  hookMocks.createProductSupplier.mockResolvedValue({
    ok: true,
    value: { relationId: "relation-1" },
  });
  hookMocks.updateProductSupplier.mockResolvedValue({
    ok: true,
    value: { relationId: "relation-1" },
  });
  hookMocks.archiveProductSupplier.mockResolvedValue({
    ok: true,
    value: { relationId: "relation-1" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useSupplierProducts", () => {
  it("lets an active Admin manage immediately without permission RPCs", async () => {
    hookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    const { result } = renderSupplierProductsHook();

    expect(result.current.canManage).toBe(true);
    expect(result.current.canAdd).toBe(true);
    expect(hookMocks.hasPermission).not.toHaveBeenCalled();
    await waitFor(() => expect(hookMocks.listActiveProductChoices).toHaveBeenCalled());
  });

  it.each(["inventory.products.edit", "suppliers.edit"] as const)(
    "allows management through %s",
    async (allowedPermission) => {
      hookMocks.hasPermission.mockImplementation((permission: string) =>
        Promise.resolve({ ok: true, value: permission === allowedPermission }));
      const { result } = renderSupplierProductsHook();

      expect(result.current.canManage).toBe(false);
      await waitFor(() => expect(result.current.canManage).toBe(true));
      expect(hookMocks.hasPermission).toHaveBeenCalledWith("inventory.products.edit");
      expect(hookMocks.hasPermission).toHaveBeenCalledWith("suppliers.edit");
    },
  );

  it("fails closed while permission checks are pending, denied, or failed", async () => {
    hookMocks.hasPermission.mockImplementation((permission: string) =>
      permission === "inventory.products.edit"
        ? Promise.resolve({ ok: true, value: true })
        : new Promise(() => undefined));
    const pending = renderSupplierProductsHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalledTimes(2));
    expect(pending.result.current.canManage).toBe(false);
    pending.unmount();
    hookMocks.hasPermission.mockClear();

    hookMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
    const denied = renderSupplierProductsHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalledTimes(2));
    expect(denied.result.current.canManage).toBe(false);
    denied.unmount();
    hookMocks.hasPermission.mockClear();

    hookMocks.hasPermission.mockImplementation((permission: string) =>
      Promise.resolve(permission === "inventory.products.edit"
        ? { ok: true, value: true }
        : { ok: false, error: { code: "permission_check_failed", message: "safe" } }));
    const failed = renderSupplierProductsHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalledTimes(2));
    expect(failed.result.current.canManage).toBe(false);
  });

  it("keeps archived Suppliers manageable only for existing links and disables Add", async () => {
    hookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result } = renderSupplierProductsHook(false);

    await waitFor(() => expect(result.current.canManage).toBe(true));
    expect(result.current.canAdd).toBe(false);
    expect(hookMocks.listActiveProductChoices).not.toHaveBeenCalled();
  });

  it("uses a profile/supplier-scoped list query", async () => {
    const { result, queryClient } = renderSupplierProductsHook();
    await waitFor(() => expect(result.current.relationQuery.isSuccess).toBe(true));

    expect(queryClient.getQueryState([
      "suppliers",
      "product-suppliers",
      "profile-1",
      "supplier-1",
    ])).toBeDefined();
  });

  it("reuses Task 054 mutations and invalidates only the exact Supplier-side list", async () => {
    const { result, queryClient } = renderSupplierProductsHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.relationQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create({ productId: "product-1", catalogNumber: "CAT-1", description: null });
      await result.current.update("relation-1", { catalogNumber: "CAT-2", description: null });
      await result.current.archive("relation-1");
    });

    expect(hookMocks.createProductSupplier).toHaveBeenCalledWith({
      supplierId: "supplier-1",
      productId: "product-1",
      catalogNumber: "CAT-1",
      description: null,
    });
    const expected = {
      queryKey: ["suppliers", "product-suppliers", "profile-1", "supplier-1"],
      exact: true,
    };
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, expected);
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, expected);
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, expected);
  });

  it("does not invalidate after a failed mutation", async () => {
    hookMocks.createProductSupplier.mockResolvedValue({
      ok: false,
      error: { code: "relationship_create_failed", message: "safe" },
    });
    const { result, queryClient } = renderSupplierProductsHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.relationQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create({ productId: "product-1", catalogNumber: "", description: null });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
