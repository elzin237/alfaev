import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  isProjectId: vi.fn(),
  listUsage: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../services/projectMaterialUsageService", () => ({
  listProjectMaterialUsage: mocks.listUsage,
}));
vi.mock("../services/projectService", () => ({ isProjectId: mocks.isProjectId }));

import { useProjectMaterialUsage } from "./useProjectMaterialUsage";

const projectId = "00000000-0000-4000-8000-000000000001";

function renderUsageHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useProjectMaterialUsage(projectId), { wrapper }), queryClient };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  mocks.isProjectId.mockReturnValue(true);
  mocks.listUsage.mockResolvedValue({ ok: true, value: [] });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("useProjectMaterialUsage", () => {
  it("uses a profile/project-scoped usage key and checks Work Order link access separately", async () => {
    const { result, queryClient } = renderUsageHook();
    await waitFor(() => expect(result.current.usageQuery.isSuccess).toBe(true));
    expect(mocks.listUsage).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(queryClient.getQueryData([
      "projects", "material-usage", "profile-1", projectId,
    ])).toEqual({ ok: true, value: [] });
    expect(mocks.hasPermission).toHaveBeenCalledExactlyOnceWith("work_orders.view");
    expect(result.current.canViewWorkOrders).toBe(false);
  });

  it("allows Work Order links for Admin or explicit view permission and fails closed otherwise", async () => {
    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true },
      isAdmin: true,
    });
    const admin = renderUsageHook();
    await waitFor(() => expect(admin.result.current.usageQuery.isSuccess).toBe(true));
    expect(admin.result.current.canViewWorkOrders).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    admin.unmount();

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-1" } },
      profile: { id: "profile-1", isActive: true },
      isAdmin: false,
    });
    mocks.hasPermission.mockResolvedValueOnce({ ok: true, value: true });
    const viewer = renderUsageHook();
    await waitFor(() => expect(viewer.result.current.canViewWorkOrders).toBe(true));
    viewer.unmount();

    mocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe" },
    });
    const failed = renderUsageHook();
    await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canViewWorkOrders).toBe(false);
  });

  it("does not query without an active profile or valid Project ID", () => {
    mocks.useAuth.mockReturnValueOnce({ session: null, profile: null, isAdmin: false });
    const missing = renderUsageHook();
    expect(missing.result.current.usageQuery.fetchStatus).toBe("idle");
    missing.unmount();

    mocks.isProjectId.mockReturnValueOnce(false);
    const invalid = renderUsageHook();
    expect(invalid.result.current.usageQuery.fetchStatus).toBe("idle");
  });
});
