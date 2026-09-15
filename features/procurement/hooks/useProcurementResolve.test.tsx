import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  resolve: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("../services/procurementService", () => ({
  resolveProcurementRequest: mocks.resolve,
}));

import { useProcurementResolve } from "./useProcurementResolve";

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
  mocks.resolve.mockResolvedValue({
    ok: true,
    value: { requestId: "00000000-0000-4000-8000-000000000001" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProcurementResolve", () => {
  it("allows Admin immediately and checks only procurement.resolve for non-Admins", async () => {
    const user = renderHook(useProcurementResolve, {
      wrapper: wrapper(createClient()),
    });
    await waitFor(() => expect(user.result.current.canResolve).toBe(true));
    expect(mocks.hasPermission).toHaveBeenCalledWith("procurement.resolve");
    user.unmount();

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });
    mocks.hasPermission.mockClear();
    const admin = renderHook(useProcurementResolve, {
      wrapper: wrapper(createClient()),
    });
    expect(admin.result.current.canResolve).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("fails closed for pending, denied, failed, and inactive permission state", async () => {
    mocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    const pending = renderHook(useProcurementResolve, {
      wrapper: wrapper(createClient()),
    });
    expect(pending.result.current.canResolve).toBe(false);
    pending.unmount();

    for (const permissionResult of [
      { ok: true, value: false },
      { ok: false, error: { code: "permission_check_failed", message: "safe" } },
    ]) {
      mocks.hasPermission.mockResolvedValue(permissionResult);
      const rendered = renderHook(useProcurementResolve, {
        wrapper: wrapper(createClient()),
      });
      await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
      expect(rendered.result.current.canResolve).toBe(false);
      rendered.unmount();
      mocks.hasPermission.mockClear();
    }

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-inactive" } },
      profile: { id: "profile-inactive", isActive: false },
      isAdmin: true,
    });
    const inactive = renderHook(useProcurementResolve, {
      wrapper: wrapper(createClient()),
    });
    expect(inactive.result.current.canResolve).toBe(false);
  });

  it("invalidates only the Procurement list prefix and exact badge on success", async () => {
    const client = createClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const rendered = renderHook(useProcurementResolve, {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await rendered.result.current.resolveRequest(
        "00000000-0000-4000-8000-000000000001",
      );
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

  it("invalidates nothing after a failed resolve", async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      error: { code: "already_resolved", message: "safe" },
    });
    const client = createClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const rendered = renderHook(useProcurementResolve, {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await rendered.result.current.resolveRequest(
        "00000000-0000-4000-8000-000000000001",
      );
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
