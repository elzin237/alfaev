import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const detailHookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  getProduct: vi.fn(),
  listBrands: vi.fn(),
  archiveProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: detailHookMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: detailHookMocks.hasPermission,
}));
vi.mock("../services/brandService", () => ({
  listBrands: detailHookMocks.listBrands,
}));
vi.mock("../services/productService", () => ({
  archiveProduct: detailHookMocks.archiveProduct,
  getProduct: detailHookMocks.getProduct,
  updateProduct: detailHookMocks.updateProduct,
}));

import { useProductDetail } from "./useProductDetail";

const activeProduct = {
  id: "product-1",
  serialNumber: "0000001",
  name: "Controller",
  category: "Control",
  brandId: null,
  brandName: null,
  brandIsActive: null,
  productKind: "component" as const,
  isActive: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T11:00:00.000Z",
  archivedAt: null,
};

function renderDetailHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useProductDetail("product-1"), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  detailHookMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  detailHookMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  detailHookMocks.getProduct.mockResolvedValue({
    ok: true,
    value: activeProduct,
  });
  detailHookMocks.listBrands.mockResolvedValue({ ok: true, value: [] });
  detailHookMocks.updateProduct.mockResolvedValue({
    ok: true,
    value: { productId: "product-1" },
  });
  detailHookMocks.archiveProduct.mockResolvedValue({
    ok: true,
    value: { productId: "product-1" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProductDetail", () => {
  it("lets an Admin edit an active Product without permission RPC lookup", async () => {
    detailHookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    const { result } = renderDetailHook();

    await waitFor(() => expect(result.current.canEdit).toBe(true));
    expect(result.current.canArchive).toBe(true);
    expect(detailHookMocks.hasPermission).not.toHaveBeenCalled();
    await waitFor(() => expect(detailHookMocks.listBrands).toHaveBeenCalled());
  });

  it("allows inventory.products.edit and fails closed while pending, denied, or failed", async () => {
    detailHookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: true });
    const allowed = renderDetailHook();
    await waitFor(() => expect(allowed.result.current.canEdit).toBe(true));
    allowed.unmount();

    detailHookMocks.hasPermission.mockReturnValueOnce(new Promise(() => undefined));
    const pending = renderDetailHook();
    await waitFor(() => expect(pending.result.current.productQuery.isSuccess).toBe(true));
    expect(pending.result.current.canEdit).toBe(false);
    pending.unmount();

    detailHookMocks.hasPermission.mockResolvedValueOnce({ ok: true, value: false });
    const denied = renderDetailHook();
    await waitFor(() => expect(detailHookMocks.hasPermission).toHaveBeenCalled());
    expect(denied.result.current.canEdit).toBe(false);
    denied.unmount();

    detailHookMocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderDetailHook();
    await waitFor(() => expect(detailHookMocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canEdit).toBe(false);
  });

  it("keeps archived Products read-only even for Admin", async () => {
    detailHookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    detailHookMocks.getProduct.mockResolvedValue({
      ok: true,
      value: {
        ...activeProduct,
        isActive: false,
        archivedAt: "2026-09-03T12:00:00.000Z",
      },
    });
    const { result } = renderDetailHook();

    await waitFor(() => expect(result.current.productQuery.isSuccess).toBe(true));
    expect(result.current.canEdit).toBe(false);
    expect(result.current.canArchive).toBe(false);
    expect(detailHookMocks.listBrands).not.toHaveBeenCalled();
  });

  it("uses profile-scoped queries and invalidates exact detail and list after update", async () => {
    detailHookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.canEdit).toBe(true));

    expect(queryClient.getQueryState([
      "inventory",
      "products",
      "detail",
      "profile-1",
      "product-1",
    ])).toBeDefined();
    expect(queryClient.getQueryState([
      "permission",
      "auth-user-1",
      "profile-1",
      "inventory.products.edit",
    ])).toBeDefined();

    await act(async () => {
      await result.current.update({
        name: "Updated Controller",
        category: "Control",
        brandId: null,
      });
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "inventory",
        "products",
        "detail",
        "profile-1",
        "product-1",
      ],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "products", "profile-1"],
      exact: true,
    });
  });

  it("does not invalidate Product queries after a failed update", async () => {
    detailHookMocks.updateProduct.mockResolvedValue({
      ok: false,
      error: { code: "product_update_failed", message: "safe" },
    });
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.productQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.update({
        name: "Controller",
        category: "Control",
        brandId: null,
      });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("reuses edit authorization and invalidates exact Product queries after archive", async () => {
    detailHookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.canArchive).toBe(true));

    await act(async () => {
      await result.current.archive();
    });

    expect(detailHookMocks.archiveProduct).toHaveBeenCalledWith("product-1");
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "inventory",
        "products",
        "detail",
        "profile-1",
        "product-1",
      ],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "products", "profile-1"],
      exact: true,
    });
  });

  it("does not invalidate Product queries after failed archive", async () => {
    detailHookMocks.archiveProduct.mockResolvedValue({
      ok: false,
      error: { code: "product_archive_failed", message: "safe" },
    });
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.productQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.archive();
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
