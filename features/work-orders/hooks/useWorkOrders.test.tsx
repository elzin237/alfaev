import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  listWorkOrders: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: hookMocks.useAuth }));
vi.mock("../services/workOrderService", () => ({
  listWorkOrders: hookMocks.listWorkOrders,
}));

import { useWorkOrders } from "./useWorkOrders";

function renderWorkOrdersHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useWorkOrders(), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  hookMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  hookMocks.listWorkOrders.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useWorkOrders", () => {
  it("uses the service through one profile-scoped query", async () => {
    const { result, queryClient } = renderWorkOrdersHook();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hookMocks.listWorkOrders).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(["work-orders", "list", "profile-1"]))
      .toEqual({ ok: true, value: [] });
  });

  it("does not call the service before profile identity is available", () => {
    hookMocks.useAuth.mockReturnValue({ profile: null });

    const { result } = renderWorkOrdersHook();

    expect(result.current.fetchStatus).toBe("idle");
    expect(hookMocks.listWorkOrders).not.toHaveBeenCalled();
  });
});
