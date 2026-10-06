import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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
});
