import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  createProduct: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: hookMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: hookMocks.hasPermission,
}));
vi.mock("../services/productService", () => ({
  createProduct: hookMocks.createProduct,
}));

import { useProductCreation } from "./useProductCreation";

function renderProductCreationHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useProductCreation(), { wrapper }),
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
  hookMocks.createProduct.mockResolvedValue({
    ok: true,
    value: { productId: "product-1", serialNumber: "0000001" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProductCreation", () => {
  it("allows an Admin immediately without checking a delegable permission", () => {
    hookMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });

    const { result } = renderProductCreationHook();

    expect(result.current.canCreate).toBe(true);
    expect(hookMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("shows creation only after inventory.products.create resolves allowed", async () => {
    hookMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result, queryClient } = renderProductCreationHook();

    expect(result.current.canCreate).toBe(false);
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    expect(hookMocks.hasPermission).toHaveBeenCalledWith(
      "inventory.products.create",
    );
    expect(queryClient.getQueryState([
      "permission",
      "auth-user-1",
      "profile-1",
      "inventory.products.create",
    ])).toBeDefined();
  });

  it("fails closed while pending, when denied, and when permission lookup fails", async () => {
    let resolvePermission: ((value: { ok: true; value: boolean }) => void) | undefined;
    hookMocks.hasPermission.mockReturnValueOnce(new Promise((resolve) => {
      resolvePermission = resolve;
    }));
    const pending = renderProductCreationHook();

    expect(pending.result.current.canCreate).toBe(false);
    resolvePermission?.({ ok: true, value: false });
    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(pending.result.current.canCreate).toBe(false);
    pending.unmount();

    hookMocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderProductCreationHook();

    await waitFor(() => expect(hookMocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canCreate).toBe(false);
  });

  it("invalidates the current profile Product-list prefix after successful creation", async () => {
    const { result, queryClient } = renderProductCreationHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.create({
        name: "Resistor",
        category: "Passive",
        brandId: null,
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "products", "profile-1"],
    });
  });

  it("does not invalidate the Product list after failed creation", async () => {
    hookMocks.createProduct.mockResolvedValue({
      ok: false,
      error: { code: "product_creation_failed", message: "safe failure" },
    });
    const { result, queryClient } = renderProductCreationHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.create({
        name: "Resistor",
        category: "Passive",
        brandId: null,
      });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
