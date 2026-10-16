import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isProjectId: vi.fn(),
  listUsage: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
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
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("useProjectMaterialUsage", () => {
  it("uses a profile/project-scoped usage key and one canonical usage read", async () => {
    const { result, queryClient } = renderUsageHook();
    await waitFor(() => expect(result.current.usageQuery.isSuccess).toBe(true));
    expect(mocks.listUsage).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(queryClient.getQueryData([
      "projects", "material-usage", "profile-1", projectId,
    ])).toEqual({ ok: true, value: [] });
    expect(Object.keys(result.current)).toEqual(["usageQuery"]);
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
