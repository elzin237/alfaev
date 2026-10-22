import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const productHookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listProducts: vi.fn(),
}));
const warehouseId = "10000000-0000-4000-8000-000000000001";

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: productHookMocks.useAuth,
}));
vi.mock("../services/productService", () => ({
  listProducts: productHookMocks.listProducts,
}));

import { useProducts } from "./useProducts";

function renderProductsHook(search = "") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useProducts(warehouseId, search), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  productHookMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  productHookMocks.listProducts.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProducts", () => {
  it("loads Products into a normalized-search and profile-scoped feature query", async () => {
    const { result, queryClient } = renderProductsHook("  resistor  ");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productHookMocks.listProducts).toHaveBeenCalledWith(warehouseId, "resistor");
    expect(queryClient.getQueryData([
      "inventory",
      "products",
      "profile-1",
      warehouseId,
      "resistor",
    ])).toEqual({ ok: true, value: [] });
  });

  it("does not read Products without a loaded profile", () => {
    productHookMocks.useAuth.mockReturnValue({ profile: null });

    const { result } = renderProductsHook();

    expect(result.current.fetchStatus).toBe("idle");
    expect(productHookMocks.listProducts).not.toHaveBeenCalled();
  });
});
