import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewAccessMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: viewAccessMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: viewAccessMocks.hasPermission,
}));

import { useWorkOrderViewAccess } from "./useWorkOrderViewAccess";

function renderViewAccessHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWorkOrderViewAccess(), { wrapper });
}

beforeEach(() => {
  viewAccessMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  viewAccessMocks.hasPermission.mockResolvedValue({ ok: true, value: false });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useWorkOrderViewAccess", () => {
  it("allows an active Admin without querying work_orders.view", () => {
    viewAccessMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });

    const { result } = renderViewAccessHook();

    expect(result.current.canView).toBe(true);
    expect(result.current.isChecking).toBe(false);
    expect(viewAccessMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("resolves effective view access through the existing permission query", async () => {
    viewAccessMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const { result } = renderViewAccessHook();

    expect(result.current.isChecking).toBe(true);
    await waitFor(() => expect(result.current.canView).toBe(true));
    expect(result.current.isChecking).toBe(false);
    expect(viewAccessMocks.hasPermission).toHaveBeenCalledExactlyOnceWith(
      "work_orders.view",
    );
  });

  it("fails closed for create-only, failed, inactive, and missing identities", async () => {
    const createOnly = renderViewAccessHook();
    await waitFor(() => expect(createOnly.result.current.isChecking).toBe(false));
    expect(createOnly.result.current.canView).toBe(false);
    createOnly.unmount();

    viewAccessMocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe failure" },
    });
    const failed = renderViewAccessHook();
    await waitFor(() => expect(failed.result.current.isChecking).toBe(false));
    expect(failed.result.current.canView).toBe(false);
    failed.unmount();

    viewAccessMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-inactive" } },
      profile: { id: "profile-inactive", isActive: false },
      isAdmin: true,
    });
    const inactive = renderViewAccessHook();
    expect(inactive.result.current.canView).toBe(false);
    inactive.unmount();

    viewAccessMocks.useAuth.mockReturnValue({
      session: null,
      profile: null,
      isAdmin: false,
    });
    const missing = renderViewAccessHook();
    expect(missing.result.current.canView).toBe(false);
  });
});
