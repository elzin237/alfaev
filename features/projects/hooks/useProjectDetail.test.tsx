import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelProject: vi.fn(), getProject: vi.fn(), hasPermission: vi.fn(),
  isProjectId: vi.fn(), updateProject: vi.fn(), useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../services/projectService", () => ({
  cancelProject: mocks.cancelProject,
  getProject: mocks.getProject,
  isProjectId: mocks.isProjectId,
  updateProject: mocks.updateProject,
}));

import { useProjectDetail } from "./useProjectDetail";

const projectId = "00000000-0000-4000-8000-000000000001";
const activeProject = {
  id: projectId, name: "Control Cabinet", customerName: "Customer",
  status: "planned" as const, startDate: "2026-09-01",
  deliveryDate: "2026-09-30", createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

function renderDetailHook() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useProjectDetail(projectId), { wrapper }), queryClient };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  mocks.isProjectId.mockReturnValue(true);
  mocks.getProject.mockResolvedValue({ ok: true, value: activeProject });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  mocks.updateProject.mockResolvedValue({ ok: true, value: { projectId } });
  mocks.cancelProject.mockResolvedValue({ ok: true, value: { projectId } });
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("useProjectDetail", () => {
  it("allows Admin edit/cancel without permission RPCs", async () => {
    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true }, isAdmin: true,
    });
    const { result } = renderDetailHook();
    await waitFor(() => expect(result.current.projectQuery.isSuccess).toBe(true));
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canCancel).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("evaluates edit and archive permissions independently", async () => {
    mocks.hasPermission.mockImplementation((permission: string) => Promise.resolve({
      ok: true, value: permission === "projects.edit",
    }));
    const editOnly = renderDetailHook();
    await waitFor(() => expect(editOnly.result.current.canEdit).toBe(true));
    expect(editOnly.result.current.canCancel).toBe(false);
    editOnly.unmount();

    mocks.hasPermission.mockImplementation((permission: string) => Promise.resolve({
      ok: true, value: permission === "projects.archive",
    }));
    const archiveOnly = renderDetailHook();
    await waitFor(() => expect(archiveOnly.result.current.canCancel).toBe(true));
    expect(archiveOnly.result.current.canEdit).toBe(false);
  });

  it("fails controls closed for pending or failed permission checks", async () => {
    mocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    const pending = renderDetailHook();
    await waitFor(() => expect(pending.result.current.projectQuery.isSuccess).toBe(true));
    expect(pending.result.current.canEdit).toBe(false);
    expect(pending.result.current.canCancel).toBe(false);
    pending.unmount();

    mocks.hasPermission.mockResolvedValue({ ok: false, error: { code: "permission_check_failed", message: "safe" } });
    const failed = renderDetailHook();
    await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
    expect(failed.result.current.canEdit).toBe(false);
    expect(failed.result.current.canCancel).toBe(false);
  });

  it("keeps Completed field-editable but non-cancellable and Cancelled read-only", async () => {
    mocks.useAuth.mockReturnValue({ session: { user: { id: "admin" } }, profile: { id: "admin", isActive: true }, isAdmin: true });
    mocks.getProject.mockResolvedValueOnce({ ok: true, value: { ...activeProject, status: "completed" } });
    const completed = renderDetailHook();
    await waitFor(() => expect(completed.result.current.projectQuery.isSuccess).toBe(true));
    expect(completed.result.current.canEdit).toBe(true);
    expect(completed.result.current.canCancel).toBe(false);
    completed.unmount();

    mocks.getProject.mockResolvedValueOnce({ ok: true, value: { ...activeProject, status: "cancelled" } });
    const cancelled = renderDetailHook();
    await waitFor(() => expect(cancelled.result.current.projectQuery.isSuccess).toBe(true));
    expect(cancelled.result.current.canEdit).toBe(false);
    expect(cancelled.result.current.canCancel).toBe(false);
  });

  it("invalidates exact detail and list queries only after successful mutations", async () => {
    const { result, queryClient } = renderDetailHook();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.projectQuery.isSuccess).toBe(true));
    await act(async () => { await result.current.update({ name: "Updated", customerName: "Customer", startDate: "2026-09-01", deliveryDate: "2026-09-30", status: "in_progress" }); });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["projects", "detail", "profile-1", projectId], exact: true });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["projects", "list", "profile-1"], exact: true });
    invalidateQueries.mockClear();
    await act(async () => { await result.current.cancel(); });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);

    invalidateQueries.mockClear();
    mocks.updateProject.mockResolvedValueOnce({ ok: false, error: { code: "project_update_failed", message: "safe" } });
    mocks.cancelProject.mockResolvedValueOnce({ ok: false, error: { code: "project_cancel_failed", message: "safe" } });
    await act(async () => {
      await result.current.update({ name: "Project", customerName: "Customer", startDate: "2026-09-01", deliveryDate: "2026-09-30", status: "planned" });
      await result.current.cancel();
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("does not query an invalid Project or missing profile", () => {
    mocks.isProjectId.mockReturnValue(false);
    const malformed = renderDetailHook();
    expect(malformed.result.current.projectQuery.fetchStatus).toBe("idle");
    malformed.unmount();
    mocks.isProjectId.mockReturnValue(true);
    mocks.useAuth.mockReturnValue({ session: null, profile: null, isAdmin: false });
    const missing = renderDetailHook();
    expect(missing.result.current.projectQuery.fetchStatus).toBe("idle");
  });
});
