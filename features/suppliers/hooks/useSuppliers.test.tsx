import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  listSuppliers: vi.fn(),
  createSupplier: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: hookMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: hookMocks.hasPermission,
}));
vi.mock("../services/supplierService", () => ({
  listSuppliers: hookMocks.listSuppliers,
  createSupplier: hookMocks.createSupplier,
}));

import { useSuppliers } from "./useSuppliers";

function renderSuppliersHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useSuppliers(), { wrapper }), queryClient };
}

beforeEach(() => {
  hookMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  hookMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  hookMocks.listSuppliers.mockResolvedValue({ ok: true, value: [] });
  hookMocks.createSupplier.mockResolvedValue({
    ok: true,
    value: { supplierId: "supplier-1" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useSuppliers", () => {
  it("allows Admin immediately without a create-permission RPC", async () => {
    hookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });

    const { result } = renderSuppliersHook();

    expect(result.current.canCreate).toBe(true);
    await waitFor(() => expect(result.current.suppliersQuery.isSuccess).toBe(true));
    expect(hookMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("shows create for a permitted user and fails closed for denied or failed checks", async () => {
    hookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: true });
    const allowed = renderSuppliersHook();
    await waitFor(() => expect(allowed.result.current.canCreate).toBe(true));
    allowed.unmount();

    hookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: false });
    const denied = renderSuppliersHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(denied.result.current.canCreate).toBe(false);
    denied.unmount();

    hookMocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderSuppliersHook();
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canCreate).toBe(false);
  });

  it("uses user-specific permission and Supplier-list cache identity", async () => {
    hookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { queryClient } = renderSuppliersHook();

    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(queryClient.getQueryState([
      "permission",
      "auth-user-1",
      "profile-1",
      "suppliers.create",
    ])).toBeDefined();
    expect(queryClient.getQueryState([
      "suppliers",
      "list",
      "profile-1",
    ])).toBeDefined();
  });

  it("invalidates exactly the current profile list after successful create only", async () => {
    const { result, queryClient } = renderSuppliersHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.suppliersQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create({
        name: "Bosch",
        country: "Germany",
        contactPersonName: null,
        contactPhone: null,
        contactEmail: null,
      });
    });

    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["suppliers", "list", "profile-1"],
      exact: true,
    });

    hookMocks.createSupplier.mockResolvedValueOnce({
      ok: false,
      error: { code: "supplier_create_failed", message: "safe" },
    });
    await act(async () => {
      await result.current.create({
        name: "ABB",
        country: "Switzerland",
        contactPersonName: null,
        contactPhone: null,
        contactEmail: null,
      });
    });
    expect(invalidateQueries).toHaveBeenCalledOnce();
  });
});
