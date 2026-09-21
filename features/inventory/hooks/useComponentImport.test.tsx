import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  importComponents: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: hookMocks.useAuth }));
vi.mock("../services/componentImportService", () => ({
  importComponents: hookMocks.importComponents,
}));

import { useComponentImport } from "./useComponentImport";

function renderImportHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useComponentImport(), { wrapper }), queryClient };
}

const rows = [{ name: "Resistor", category: "Passive", brand: null }];

beforeEach(() => {
  vi.resetAllMocks();
  hookMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  hookMocks.importComponents.mockResolvedValue({
    ok: true,
    value: {
      createdCount: 1,
      products: [{ inputIndex: 1, productId: "product-1", serialNumber: "0000001" }],
    },
  });
});

afterEach(cleanup);

describe("useComponentImport", () => {
  it("calls the service once and invalidates only Product prefix and exact commitments", async () => {
    const { result, queryClient } = renderImportHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.importBatch(rows); });

    expect(hookMocks.importComponents).toHaveBeenCalledOnce();
    expect(hookMocks.importComponents).toHaveBeenCalledWith(rows);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "products", "profile-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["inventory", "commitments", "profile-1"], exact: true,
    });
  });

  it("does not invalidate after a failed import", async () => {
    hookMocks.importComponents.mockResolvedValue({
      ok: false,
      error: { code: "import_failed", message: "safe" },
    });
    const { result, queryClient } = renderImportHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => { await result.current.importBatch(rows); });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
