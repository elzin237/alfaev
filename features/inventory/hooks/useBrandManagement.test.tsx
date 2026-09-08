import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  listBrands: vi.fn(),
  createBrand: vi.fn(),
  updateBrand: vi.fn(),
  archiveBrand: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: hookMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: hookMocks.hasPermission,
}));
vi.mock("../services/brandService", () => ({
  listBrands: hookMocks.listBrands,
  createBrand: hookMocks.createBrand,
  updateBrand: hookMocks.updateBrand,
  archiveBrand: hookMocks.archiveBrand,
}));

import { useBrandManagement } from "./useBrandManagement";

function renderManagementHook(isAdmin: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useBrandManagement(), { wrapper });
  return { ...rendered, queryClient, isAdmin };
}

beforeEach(() => {
  hookMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  hookMocks.listBrands.mockResolvedValue({ ok: true, value: [] });
  hookMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  hookMocks.createBrand.mockResolvedValue({
    ok: true,
    value: { brandId: "brand-1" },
  });
  hookMocks.updateBrand.mockResolvedValue({
    ok: true,
    value: { brandId: "brand-1" },
  });
  hookMocks.archiveBrand.mockResolvedValue({
    ok: true,
    value: { brandId: "brand-1" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useBrandManagement", () => {
  it("allows Admin immediately without a permission RPC", async () => {
    hookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });

    const { result } = renderManagementHook(true);

    expect(result.current.canManage).toBe(true);
    await waitFor(() => expect(result.current.brandsQuery.isSuccess).toBe(true));
    expect(hookMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows a permitted non-admin and fails closed for denied/errors", async () => {
    hookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: true });
    const allowed = renderManagementHook(false);
    await waitFor(() => expect(allowed.result.current.canManage).toBe(true));
    allowed.unmount();

    hookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: false });
    const denied = renderManagementHook(false);
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(denied.result.current.canManage).toBe(false);
    denied.unmount();

    hookMocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderManagementHook(false);
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canManage).toBe(false);
  });

  it("uses user-specific permission cache identity", async () => {
    hookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { queryClient } = renderManagementHook(false);

    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(
      queryClient.getQueryState([
        "permission",
        "auth-user-1",
        "profile-1",
        "inventory.brands.manage",
      ]),
    ).toBeDefined();
  });

  it("invalidates only the current profile's Brand list after each successful mutation", async () => {
    const { result, queryClient } = renderManagementHook(false);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.brandsQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create("Bosch");
      await result.current.update("brand-1", "ABB");
      await result.current.archive("brand-1");
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "brands", "profile-1"],
      exact: true,
    });
  });
});
