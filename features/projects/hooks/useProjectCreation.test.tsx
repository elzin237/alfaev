import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectCreationMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: projectCreationMocks.useAuth,
}));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: projectCreationMocks.hasPermission,
}));
vi.mock("../services/projectService", () => ({
  createProject: projectCreationMocks.createProject,
}));

import { useProjectCreation } from "./useProjectCreation";

function renderProjectCreationHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useProjectCreation(), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  projectCreationMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  projectCreationMocks.hasPermission.mockResolvedValue({
    ok: true,
    value: false,
  });
  projectCreationMocks.createProject.mockResolvedValue({
    ok: true,
    value: { projectId: "00000000-0000-4000-8000-000000000010" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProjectCreation", () => {
  it("allows an Admin immediately without requesting projects.create", () => {
    projectCreationMocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-admin" } },
      profile: { id: "profile-admin", isActive: true },
      isAdmin: true,
    });

    const { result } = renderProjectCreationHook();

    expect(result.current.canCreate).toBe(true);
    expect(projectCreationMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows a non-Admin only after projects.create resolves allowed", async () => {
    projectCreationMocks.hasPermission.mockResolvedValue({
      ok: true,
      value: true,
    });
    const { result, queryClient } = renderProjectCreationHook();

    expect(result.current.canCreate).toBe(false);
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    expect(projectCreationMocks.hasPermission).toHaveBeenCalledWith(
      "projects.create",
    );
    expect(queryClient.getQueryState([
      "permission",
      "auth-user-1",
      "profile-1",
      "projects.create",
    ])).toBeDefined();
  });

  it("fails closed while pending, when denied, and on permission failure", async () => {
    let resolvePermission:
      | ((value: { ok: true; value: boolean }) => void)
      | undefined;
    projectCreationMocks.hasPermission.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePermission = resolve;
      }),
    );
    const pending = renderProjectCreationHook();

    expect(pending.result.current.canCreate).toBe(false);
    resolvePermission?.({ ok: true, value: false });
    await waitFor(() => expect(projectCreationMocks.hasPermission).toHaveBeenCalled());
    expect(pending.result.current.canCreate).toBe(false);
    pending.unmount();

    projectCreationMocks.hasPermission.mockResolvedValueOnce({
      ok: false,
      error: { code: "permission_check_failed", message: "safe failure" },
    });
    const failed = renderProjectCreationHook();

    await waitFor(() => expect(projectCreationMocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canCreate).toBe(false);
  });

  it("fails closed without an active authenticated profile", () => {
    projectCreationMocks.useAuth.mockReturnValue({
      session: null,
      profile: null,
      isAdmin: true,
    });

    const { result } = renderProjectCreationHook();

    expect(result.current.canCreate).toBe(false);
    expect(projectCreationMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("invalidates the exact identity-scoped Project list after success", async () => {
    const { result, queryClient } = renderProjectCreationHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.create({
        name: "Project",
        customerName: "Customer",
        startDate: "2026-09-01",
        deliveryDate: "2026-09-30",
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects", "list", "profile-1"],
      exact: true,
    });
  });

  it("does not invalidate the list after failed creation", async () => {
    projectCreationMocks.createProject.mockResolvedValue({
      ok: false,
      error: { code: "project_create_failed", message: "safe failure" },
    });
    const { result, queryClient } = renderProjectCreationHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.create({
        name: "Project",
        customerName: "Customer",
        startDate: "2026-09-01",
        deliveryDate: "2026-09-30",
      });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
