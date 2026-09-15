import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  update: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("../services/procurementService", () => ({
  updateProcurementDeliveredQuantity: mocks.update,
}));

import { useProcurementDeliveryUpdate } from "./useProcurementDeliveryUpdate";

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
  mocks.update.mockResolvedValue({
    ok: true,
    value: { requestId: "00000000-0000-4000-8000-000000000001" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProcurementDeliveryUpdate", () => {
  it("allows Admin without a permission lookup and change-status users only", async () => {
    const allowed = renderHook(useProcurementDeliveryUpdate, {
      wrapper: wrapper(createClient()),
    });
    await waitFor(() => expect(allowed.result.current.canUpdateDelivery).toBe(true));
    expect(mocks.hasPermission).toHaveBeenCalledWith("procurement.change_status");
    allowed.unmount();

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    mocks.hasPermission.mockClear();
    const admin = renderHook(useProcurementDeliveryUpdate, {
      wrapper: wrapper(createClient()),
    });
    expect(admin.result.current.canUpdateDelivery).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("fails closed while permission is pending, denied, or failed", async () => {
    mocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    const pending = renderHook(useProcurementDeliveryUpdate, {
      wrapper: wrapper(createClient()),
    });
    expect(pending.result.current.canUpdateDelivery).toBe(false);
    pending.unmount();

    for (const result of [
      { ok: true, value: false },
      { ok: false, error: { code: "permission_check_failed", message: "safe" } },
    ]) {
      mocks.hasPermission.mockResolvedValue(result);
      const rendered = renderHook(useProcurementDeliveryUpdate, {
        wrapper: wrapper(createClient()),
      });
      await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
      expect(rendered.result.current.canUpdateDelivery).toBe(false);
      rendered.unmount();
      mocks.hasPermission.mockClear();
    }
  });

  it("invalidates only list prefix and exact badge after success", async () => {
    const client = createClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const rendered = renderHook(useProcurementDeliveryUpdate, {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await rendered.result.current.updateDelivery({
        requestId: "00000000-0000-4000-8000-000000000001",
        deliveredQuantity: 5,
      });
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenNthCalledWith(1, {
      queryKey: ["procurement", "profile-1", "list"],
    });
    expect(invalidate).toHaveBeenNthCalledWith(2, {
      queryKey: ["procurement", "profile-1", "badge"],
      exact: true,
    });
  });

  it("invalidates nothing after a safe backend failure", async () => {
    mocks.update.mockResolvedValue({
      ok: false,
      error: { code: "request_resolved", message: "safe" },
    });
    const client = createClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const rendered = renderHook(useProcurementDeliveryUpdate, {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await rendered.result.current.updateDelivery({
        requestId: "00000000-0000-4000-8000-000000000001",
        deliveredQuantity: 5,
      });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
