import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dashboardQueryKey } from "../../dashboard/dashboardQueryKeys";
import type { DashboardReadModel } from "../../dashboard/services/dashboardService";
import type { ProjectUpdateInput } from "../services/projectService";
import type { ProjectStatus } from "../projectStatus";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), detail: vi.fn(), update: vi.fn(), cancel: vi.fn(), reopen: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: vi.fn() }));
vi.mock("../../dashboard/services/dashboardService", () => ({ getDashboardReadModel: mocks.read }));
vi.mock("../services/projectService", () => ({ getProject: mocks.detail, updateProject: mocks.update, cancelProject: mocks.cancel, reopenProject: mocks.reopen, isProjectId: () => true }));
import { useProjectDetail } from "./useProjectDetail";
import { useDashboard } from "../../dashboard/hooks/useDashboard";

const id = "00000000-0000-4000-8000-000000000001";
let project: { id: string; name: string; customerName: string; status: ProjectStatus; startDate: string; deliveryDate: string; updatedAt: string };

function snapshot(): DashboardReadModel {
  return {
    projects: { statusCounts: { planned: project.status === "planned" ? 1 : 0, inProgress: project.status === "in_progress" ? 1 : 0, onHold: project.status === "on_hold" ? 1 : 0, completed: project.status === "completed" ? 1 : 0, cancelled: project.status === "cancelled" ? 1 : 0 }, recent: [{ ...project }] },
    workOrders: null, procurement: null, inventory: null, activity: null, calendar: { upcoming: [] },
  };
}

beforeEach(() => {
  project = { id, name: "Original Project", customerName: "Customer", status: "planned", startDate: "2026-10-01", deliveryDate: "2026-11-01", updatedAt: "2026-10-29T10:00:00Z" };
  mocks.auth.mockReturnValue({ session: { user: { id: "actor-1" } }, profile: { id: "profile-1", isActive: true }, isActive: true, isAdmin: true });
  mocks.detail.mockImplementation(async () => ({ ok: true, value: { ...project } }));
  mocks.read.mockImplementation(async () => ({ ok: true, value: snapshot() }));
  mocks.update.mockImplementation(async (_id: string, input: ProjectUpdateInput) => { project = { ...project, ...input }; return { ok: true, value: { projectId: id } }; });
  mocks.cancel.mockImplementation(async () => { project = { ...project, status: "cancelled" }; return { ok: true, value: { projectId: id } }; });
  mocks.reopen.mockImplementation(async () => { project = { ...project, status: "in_progress" }; return { ok: true, value: { projectId: id } }; });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderPair() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } } });
  client.setQueryData(dashboardQueryKey("other-profile"), { ok: true, value: "Other profile snapshot" });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(() => ({ detail: useProjectDetail(id), dashboard: useDashboard() }), { wrapper }), client };
}

it.each([
  ["planned", "in_progress", "inProgress"],
  ["in_progress", "on_hold", "onHold"],
] as const)("refreshes Dashboard records and counters after %s → %s confirmation", async (from, to, counter) => {
  project.status = from;
  const view = renderPair();
  await waitFor(() => expect(view.result.current.dashboard.isSuccess).toBe(true));
  await act(async () => { await view.result.current.detail.update({ ...project, status: to }); });
  await waitFor(() => expect(view.result.current.dashboard.data).toMatchObject({ ok: true, value: { projects: { statusCounts: { [counter]: 1 }, recent: [{ status: to }] } } }));
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(view.client.getQueryState(dashboardQueryKey("other-profile"))?.isInvalidated).toBe(false);
});

it("refreshes cancellation and preserves the separate profile cache", async () => {
  const view = renderPair();
  await waitFor(() => expect(view.result.current.dashboard.isSuccess).toBe(true));
  await act(async () => { await view.result.current.detail.cancel(); });
  await waitFor(() => expect(view.result.current.dashboard.data).toMatchObject({ ok: true, value: { projects: { statusCounts: { planned: 0, cancelled: 1 }, recent: [{ status: "cancelled" }] } } }));
  expect(view.client.getQueryData(dashboardQueryKey("other-profile"))).toEqual({ ok: true, value: "Other profile snapshot" });
});

it("refreshes Project name, customer and dates after a confirmed edit", async () => {
  const view = renderPair();
  await waitFor(() => expect(view.result.current.dashboard.isSuccess).toBe(true));
  const edited = { ...project, name: "Renamed Project", customerName: "New Customer", startDate: "2026-10-02", deliveryDate: "2026-12-01", status: "planned" as const };
  await act(async () => { await view.result.current.detail.update(edited); });
  await waitFor(() => expect(view.result.current.dashboard.data).toMatchObject({ ok: true, value: { projects: { recent: [edited] } } }));
});

it("does not refresh Dashboard before confirmation or after failed mutations", async () => {
  const view = renderPair();
  await waitFor(() => expect(view.result.current.dashboard.isSuccess).toBe(true));
  let complete: ((result: unknown) => void) | undefined;
  mocks.update.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  let pending: ReturnType<typeof view.result.current.detail.update> | undefined;
  act(() => { pending = view.result.current.detail.update({ ...project, status: "in_progress" }); });
  expect(mocks.read).toHaveBeenCalledOnce();
  await act(async () => { complete?.({ ok: false, error: { code: "project_update_failed", message: "Denied" } }); await pending; });
  mocks.cancel.mockResolvedValueOnce({ ok: false, error: { code: "project_cancel_failed", message: "Denied" } });
  await act(async () => { await view.result.current.detail.cancel(); });
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(view.client.getQueryState(dashboardQueryKey("profile-1"))?.isInvalidated).toBe(false);
});
