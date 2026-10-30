import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const creationMocks = vi.hoisted(() => ({
  createDraftWorkOrder: vi.fn(),
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: creationMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: creationMocks.hasPermission,
}));
vi.mock("../services/workOrderService", () => ({
  createDraftWorkOrder: creationMocks.createDraftWorkOrder,
}));

import { useWorkOrderCreation } from "./useWorkOrderCreation";

function renderCreationHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useWorkOrderCreation(), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  creationMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  creationMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  creationMocks.createDraftWorkOrder.mockResolvedValue({
    ok: true,
    value: {
      workOrderId: "00000000-0000-4000-8000-000000000010",
      workOrderNumber: "RN-2026-0042",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useWorkOrderCreation", () => {
  it("allows an active Admin without a delegable permission lookup", () => {
    creationMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });

    const { result } = renderCreationHook();

    expect(result.current.canCreate).toBe(true);
    expect(creationMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows an active non-Admin only after work_orders.create is granted", async () => {
    creationMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result, queryClient } = renderCreationHook();

    expect(result.current.canCreate).toBe(false);
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    expect(creationMocks.hasPermission).toHaveBeenCalledWith("work_orders.create");
    expect(queryClient.getQueryState([
      "permission",
      "auth-user-1",
      "profile-1",
      "work_orders.create",
    ])).toBeDefined();
  });

  it("fails closed for denied, inactive, and missing identities", async () => {
    const denied = renderCreationHook();
    await waitFor(() => expect(creationMocks.hasPermission).toHaveBeenCalled());
    expect(denied.result.current.canCreate).toBe(false);
    denied.unmount();

    creationMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-inactive" } },
      profile: { id: "profile-inactive", isActive: false },
      isAdmin: true,
    });
    const inactive = renderCreationHook();
    expect(inactive.result.current.canCreate).toBe(false);
    inactive.unmount();

    creationMocks.useAuth.mockReturnValue({
      session: null,
      profile: null,
      isAdmin: false,
    });
    const missing = renderCreationHook();
    expect(missing.result.current.canCreate).toBe(false);
  });

  it("exposes pending state and invalidates only the current profile list on success", async () => {
    creationMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    let resolveCreation:
      | ((value: Awaited<ReturnType<typeof creationMocks.createDraftWorkOrder>>) => void)
      | undefined;
    creationMocks.createDraftWorkOrder.mockReturnValue(new Promise((resolve) => {
      resolveCreation = resolve;
    }));
    const { result, queryClient } = renderCreationHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.canCreate).toBe(true));

    let creationPromise: ReturnType<typeof result.current.create>;
    act(() => {
      creationPromise = result.current.create();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    resolveCreation?.({
      ok: true,
      value: {
        workOrderId: "00000000-0000-4000-8000-000000000010",
        workOrderNumber: "RN-2026-0042",
      },
    });
    await act(async () => { await creationPromise; });

    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: ["work-orders", "list", "profile-1"],
      exact: true,
    });
  });

  it("does not invalidate after a failed creation", async () => {
    creationMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    creationMocks.createDraftWorkOrder.mockResolvedValue({
      ok: false,
      error: { code: "work_order_create_failed", message: "safe failure" },
    });
    const { result, queryClient } = renderCreationHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.canCreate).toBe(true));

    await act(async () => { await result.current.create(); });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
// Base creation behavior with commitment reads OFF; ON invalidation has focused coverage.
vi.mock("../../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>false}));
vi.mock("../../../app/config/unifiedCommittedActivation",()=>({isUnifiedCommittedEnabled:()=>false}));
