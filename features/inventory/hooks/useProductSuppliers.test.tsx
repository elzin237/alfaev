import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  listActiveSupplierChoices: vi.fn(),
  listProductSuppliers: vi.fn(),
  createProductSupplier: vi.fn(),
  archiveProductSupplier: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: hookMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: hookMocks.hasPermission,
}));
vi.mock("../services/productSupplierService", () => ({
  listActiveSupplierChoices: hookMocks.listActiveSupplierChoices,
  listProductSuppliers: hookMocks.listProductSuppliers,
  createProductSupplier: hookMocks.createProductSupplier,
  archiveProductSupplier: hookMocks.archiveProductSupplier,
}));

import { useProductSuppliers } from "./useProductSuppliers";

function renderProductSuppliersHook(productIsActive = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(
      () => useProductSuppliers("product-1", productIsActive),
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
  hookMocks.listActiveSupplierChoices.mockResolvedValue({ ok: true, value: [] });
  hookMocks.listProductSuppliers.mockResolvedValue({ ok: true, value: [] });
  hookMocks.createProductSupplier.mockResolvedValue({
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

describe("useProductSuppliers", () => {
  it("lets an active Admin manage immediately without permission RPCs", async () => {
    hookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    const { result } = renderProductSuppliersHook();

    expect(result.current.canManage).toBe(true);
    expect(result.current.canAdd).toBe(true);
    expect(hookMocks.hasPermission).not.toHaveBeenCalled();
    await waitFor(() => expect(hookMocks.listActiveSupplierChoices).toHaveBeenCalled());
  });

  it.each(["inventory.products.edit", "suppliers.edit"] as const)(
    "allows management through %s",
    async (allowedPermission) => {
      hookMocks.hasPermission.mockImplementation((permission: string) =>
        Promise.resolve({ ok: true, value: permission === allowedPermission }));
      const { result } = renderProductSuppliersHook();

      expect(result.current.canManage).toBe(false);
      await waitFor(() => expect(result.current.canManage).toBe(true));
      expect(hookMocks.hasPermission).toHaveBeenCalledWith(
        "inventory.products.edit",
      );
      expect(hookMocks.hasPermission).toHaveBeenCalledWith("suppliers.edit");
    },
  );

  it("fails management closed while permission checks are pending, denied, or failed", async () => {
    hookMocks.hasPermission.mockImplementation((permission: string) => {
      if (permission === "inventory.products.edit") {
        return Promise.resolve({ ok: true, value: true });
      }
      return new Promise(() => undefined);
    });
    const pending = renderProductSuppliersHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalledTimes(2));
    expect(pending.result.current.canManage).toBe(false);
    pending.unmount();
    hookMocks.hasPermission.mockClear();

    hookMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
    const denied = renderProductSuppliersHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalledTimes(2));
    expect(denied.result.current.canManage).toBe(false);
    denied.unmount();
    hookMocks.hasPermission.mockClear();

    hookMocks.hasPermission.mockImplementation((permission: string) =>
      Promise.resolve(permission === "inventory.products.edit"
        ? { ok: true, value: true }
        : {
            ok: false,
            error: { code: "permission_check_failed", message: "safe" },
          }));
    const failed = renderProductSuppliersHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalledTimes(2));
    expect(failed.result.current.canManage).toBe(false);
  });

  it("keeps archived Products manageable only for existing links and disables Add", async () => {
    hookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result } = renderProductSuppliersHook(false);

    await waitFor(() => expect(result.current.canManage).toBe(true));
    expect(result.current.canAdd).toBe(false);
    expect(hookMocks.listActiveSupplierChoices).not.toHaveBeenCalled();
  });

  it("uses a profile/product-scoped list query", async () => {
    const { result, queryClient } = renderProductSuppliersHook();
    await waitFor(() => expect(result.current.relationQuery.isSuccess).toBe(true));

    expect(queryClient.getQueryState([
      "inventory",
      "products",
      "suppliers",
      "profile-1",
      "product-1",
    ])).toBeDefined();
  });

  it("invalidates only the exact Product Supplier list after successful link mutations", async () => {
    const { result, queryClient } = renderProductSuppliersHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.relationQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create({ supplierId: "supplier-1" });
      await result.current.archive("relation-1");
    });

    const expected = {
      queryKey: [
        "inventory",
        "products",
        "suppliers",
        "profile-1",
        "product-1",
      ],
      exact: true,
    };
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, expected);
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, expected);
    expect(invalidateQueries).not.toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["inventory", "products", "profile-1"],
    }));
  });

  it("does not invalidate after a failed mutation", async () => {
    hookMocks.createProductSupplier.mockResolvedValue({
      ok: false,
      error: { code: "relationship_create_failed", message: "safe" },
    });
    const { result, queryClient } = renderProductSuppliersHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.relationQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create({ supplierId: "supplier-1" });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
