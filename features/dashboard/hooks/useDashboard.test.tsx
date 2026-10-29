import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardReadModel: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../services/dashboardService", () => ({
  getDashboardReadModel: mocks.getDashboardReadModel,
}));

import { dashboardQueryKey } from "../dashboardQueryKeys";
import { useDashboard } from "./useDashboard";

function renderDashboardHook(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useDashboard(), { wrapper }), queryClient };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  mocks.getDashboardReadModel.mockResolvedValue({ ok: true, value: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.resetAllMocks();
});

describe("useDashboard", () => {
  it("uses one stable profile-scoped query key", async () => {
    const { result, queryClient, rerender } = renderDashboardHook();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(dashboardQueryKey("profile-1"))
      .toEqual(["dashboard", "read-model", "profile-1"]);
    expect(queryClient.getQueryData(dashboardQueryKey("profile-1")))
      .toEqual({ ok: true, value: {} });
    rerender();
    expect(mocks.getDashboardReadModel).toHaveBeenCalledOnce();
  });

  it("changes cache identity when the authenticated profile changes", async () => {
    const rendered = renderDashboardHook();
    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    mocks.useAuth.mockReturnValue({ profile: { id: "profile-2" } });
    rendered.rerender();
    await waitFor(() => expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(2));

    expect(rendered.queryClient.getQueryData(dashboardQueryKey("profile-1")))
      .toBeDefined();
    expect(rendered.queryClient.getQueryData(dashboardQueryKey("profile-2")))
      .toBeDefined();
  });

  it("never surfaces a previous profile's cached Dashboard while the next profile loads", async () => {
    let resolveSecondProfile: ((value: unknown) => void) | undefined;
    mocks.getDashboardReadModel
      .mockResolvedValueOnce({
        ok: true,
        value: { projects: { recent: [{ name: "Privileged Project" }] } },
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondProfile = resolve;
      }));

    const rendered = renderDashboardHook();
    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data).toMatchObject({
      value: { projects: { recent: [{ name: "Privileged Project" }] } },
    });

    mocks.useAuth.mockReturnValue({ profile: { id: "profile-2" } });
    rendered.rerender();

    expect(rendered.result.current.data).toBeUndefined();
    expect(rendered.result.current.isPending).toBe(true);
    expect(rendered.queryClient.getQueryData(dashboardQueryKey("profile-1")))
      .toBeDefined();
    expect(rendered.queryClient.getQueryData(dashboardQueryKey("profile-2")))
      .toBeUndefined();

    await act(async () => resolveSecondProfile?.({
      ok: true,
      value: { projects: null },
    }));
    await waitFor(() => expect(rendered.result.current.isSuccess).toBe(true));
    expect(rendered.result.current.data).toEqual({
      ok: true,
      value: { projects: null },
    });
  });

  it("does not issue the Dashboard query before profile identity is available", () => {
    mocks.useAuth.mockReturnValue({ profile: null });
    const { result } = renderDashboardHook();
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.getDashboardReadModel).not.toHaveBeenCalled();
  });

  it("refetches only the Dashboard service on explicit retry", async () => {
    const { result } = renderDashboardHook();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await result.current.refetch();
    expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(2);
  });

  it("refreshes a still-fresh snapshot on return to Dashboard", async () => {
    const first = renderDashboardHook();
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    mocks.getDashboardReadModel.mockResolvedValueOnce({ ok: true, value: { projects: { recent: [{ status: "completed" }] } } });
    const second = renderDashboardHook(first.queryClient);
    await waitFor(() => expect(second.result.current.data).toMatchObject({ value: { projects: { recent: [{ status: "completed" }] } } }));
    expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(2);
  });

  it("refreshes on focus and reconnect even with the app-wide focus default disabled", async () => {
    focusManager.setFocused(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    const view = renderDashboardHook(client);
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(2));
    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(3));
  });

  it("observes another tab/user's confirmed edits within one visible refresh interval", async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    const view = renderDashboardHook();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledOnce();
    mocks.getDashboardReadModel.mockResolvedValue({ ok: true, value: { projects: { recent: [{ name: "Changed elsewhere", status: "in_progress" }] } } });
    await act(async () => { await vi.advanceTimersByTimeAsync(59_998); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(2);
    expect(view.result.current.data).toMatchObject({ value: { projects: { recent: [{ name: "Changed elsewhere", status: "in_progress" }] } } });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(2);
  });

  it("does not poll hidden/unfocused Dashboards and refreshes when focus returns", async () => {
    vi.useFakeTimers();
    focusManager.setFocused(false);
    renderDashboardHook();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledOnce();
    await act(async () => { focusManager.setFocused(true); await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate the refresh loop under Strict Mode remounting", async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>;
    const view = renderHook(() => useDashboard(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(3);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.getDashboardReadModel).toHaveBeenCalledTimes(3);
  });
});
