import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  listInventoryMovements: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: hookMocks.useAuth,
}));
vi.mock("../services/inventoryMovementService", () => ({
  listInventoryMovements: hookMocks.listInventoryMovements,
}));

import { useInventoryMovements } from "./useInventoryMovements";

function renderMovementsHook(productId = "product-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useInventoryMovements(productId), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  hookMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  hookMocks.listInventoryMovements.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useInventoryMovements", () => {
  it("uses a profile/Product-scoped history query", async () => {
    const { result, queryClient } = renderMovementsHook();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState([
      "inventory",
      "movements",
      "product",
      "profile-1",
      "product-1",
    ])).toBeDefined();
    expect(hookMocks.listInventoryMovements).toHaveBeenCalledWith("product-1");
  });

  it("does not read history without a loaded profile", () => {
    hookMocks.useAuth.mockReturnValue({ profile: null });
    const { result } = renderMovementsHook();

    expect(result.current.fetchStatus).toBe("idle");
    expect(hookMocks.listInventoryMovements).not.toHaveBeenCalled();
  });
});
