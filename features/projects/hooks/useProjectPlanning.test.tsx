import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  getProjectPlanning: vi.fn(),
  searchPlanningProductChoices: vi.fn(),
  createProjectProduct: vi.fn(),
  createProjectRequirement: vi.fn(),
  updateProjectProduct: vi.fn(),
  updateProjectRequirement: vi.fn(),
  removeProjectProduct: vi.fn(),
  removeProjectRequirement: vi.fn(),
}));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../services/projectPlanningService", () => ({
  getProjectPlanning: mocks.getProjectPlanning,
  searchPlanningProductChoices: mocks.searchPlanningProductChoices,
  createProjectProduct: mocks.createProjectProduct,
  createProjectRequirement: mocks.createProjectRequirement,
  updateProjectProduct: mocks.updateProjectProduct,
  updateProjectRequirement: mocks.updateProjectRequirement,
  removeProjectProduct: mocks.removeProjectProduct,
  removeProjectRequirement: mocks.removeProjectRequirement,
}));

import { useProjectPlanning } from "./useProjectPlanning";
import {
  projectPlanningChoicesQueryKey,
  projectPlanningQueryKey,
} from "../projectPlanningQueryKeys";

const projectId = "00000000-0000-4000-8000-000000000001";

function renderPlanning(status: "planned" | "completed" | "cancelled" = "planned") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useProjectPlanning(projectId, status, true, "  Relay  "), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  mocks.getProjectPlanning.mockResolvedValue({ ok: true, value: [] });
  mocks.searchPlanningProductChoices.mockResolvedValue({ ok: true, value: [] });
  for (const name of [
    "createProjectProduct", "createProjectRequirement",
    "updateProjectProduct", "updateProjectRequirement",
    "removeProjectProduct", "removeProjectRequirement",
  ] as const) {
    mocks[name].mockResolvedValue({
      ok: true, value: { id: "00000000-0000-4000-8000-000000000002" },
    });
  }
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("useProjectPlanning", () => {
  it("isolates planning and choices by identity/Project/search and permits Admin without a permission RPC", async () => {
    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true },
      isAdmin: true,
    });
    const { result, queryClient } = renderPlanning();
    await waitFor(() => expect(result.current.planningQuery.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.choicesQuery.isSuccess).toBe(true));
    expect(result.current.canManage).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(projectPlanningQueryKey("admin-profile", projectId)))
      .toEqual({ ok: true, value: [] });
    expect(queryClient.getQueryData(
      projectPlanningChoicesQueryKey("admin-profile", projectId, "Relay"),
    )).toEqual({ ok: true, value: [] });
    expect(mocks.searchPlanningProductChoices).toHaveBeenCalledWith("Relay");
  });

  it("fails controls closed for view-only, pending, error, missing profile, and closed lifecycle", async () => {
    const viewOnly = renderPlanning();
    await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
    expect(viewOnly.result.current.canManage).toBe(false);
    expect(mocks.searchPlanningProductChoices).not.toHaveBeenCalled();
    viewOnly.unmount();

    mocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    const pending = renderPlanning();
    expect(pending.result.current.canManage).toBe(false);
    pending.unmount();

    mocks.hasPermission.mockResolvedValue({ ok: false, error: { message: "safe" } });
    const failed = renderPlanning();
    await waitFor(() => expect(failed.result.current.planningQuery.isSuccess).toBe(true));
    expect(failed.result.current.canManage).toBe(false);
    failed.unmount();

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true },
      isAdmin: true,
    });
    for (const status of ["completed", "cancelled"] as const) {
      const closed = renderPlanning(status);
      expect(closed.result.current.canManage).toBe(false);
      closed.unmount();
    }
    mocks.useAuth.mockReturnValue({ session: null, profile: null, isAdmin: false });
    const missing = renderPlanning();
    expect(missing.result.current.planningQuery.fetchStatus).toBe("idle");
    expect(missing.result.current.canManage).toBe(false);
  });

  it("allows projects.edit without inventory.view and invalidates only exact planning after success", async () => {
    mocks.hasPermission.mockImplementation((key: string) =>
      Promise.resolve({ ok: true, value: key === "projects.edit" })
    );
    const { result, queryClient } = renderPlanning();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.canManage).toBe(true));
    await waitFor(() => expect(result.current.choicesQuery.isSuccess).toBe(true));
    await act(async () => { await result.current.createGroup("B24"); });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectPlanningQueryKey("profile-1", projectId),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.hasPermission).toHaveBeenCalledWith("projects.edit");
    invalidate.mockClear();
    mocks.removeProjectProduct.mockResolvedValueOnce({
      ok: false, error: { code: "children_present", message: "safe" },
    });
    await act(async () => { await result.current.removeGroup("group-id"); });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
