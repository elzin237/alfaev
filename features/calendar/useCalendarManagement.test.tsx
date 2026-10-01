import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCalendarEntry: vi.fn(),
  deleteCalendarEntry: vi.fn(),
  listCalendarEmployeeChoices: vi.fn(),
  updateCalendarEntry: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("./calendarService", () => ({
  createCalendarEntry: mocks.createCalendarEntry,
  deleteCalendarEntry: mocks.deleteCalendarEntry,
  listCalendarEmployeeChoices: mocks.listCalendarEmployeeChoices,
  updateCalendarEntry: mocks.updateCalendarEntry,
}));

import { useCalendarManagement } from "./useCalendarManagement";

function renderManagement() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useCalendarManagement(), { wrapper }), invalidate };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    profile: { id: "profile-1", isActive: true },
    isAdmin: true,
  });
  mocks.listCalendarEmployeeChoices.mockResolvedValue({ ok: true, value: [] });
  mocks.createCalendarEntry.mockResolvedValue({
    ok: true,
    value: { id: "00000000-0000-4000-8000-000000000001", updatedAt: "2026-10-01T00:00:00+00:00" },
  });
  mocks.updateCalendarEntry.mockResolvedValue({
    ok: true,
    value: { id: "00000000-0000-4000-8000-000000000001", updatedAt: "2026-10-01T00:00:01+00:00" },
  });
  mocks.deleteCalendarEntry.mockResolvedValue({
    ok: true,
    value: { id: "00000000-0000-4000-8000-000000000001", updatedAt: "2026-10-01T00:00:01+00:00" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useCalendarManagement", () => {
  it("loads employee choices only for an active Admin", async () => {
    const { result } = renderManagement();
    await waitFor(() => expect(result.current.employeesQuery.isSuccess).toBe(true));
    expect(result.current.canManage).toBe(true);
    expect(mocks.listCalendarEmployeeChoices).toHaveBeenCalledOnce();

    cleanup();
    mocks.useAuth.mockReturnValue({
      profile: { id: "profile-2", isActive: true },
      isAdmin: false,
    });
    const nonAdmin = renderManagement();
    expect(nonAdmin.result.current.canManage).toBe(false);
    expect(nonAdmin.result.current.employeesQuery.fetchStatus).toBe("idle");
    expect(mocks.listCalendarEmployeeChoices).toHaveBeenCalledOnce();
  });

  it("invalidates only entries after success and never birthdays", async () => {
    const { result, invalidate } = renderManagement();
    const entry = {
      id: "00000000-0000-4000-8000-000000000001",
      entryType: "event" as const,
      title: "Review",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      description: null,
      relatedUserId: null,
      updatedAt: "2026-10-01T00:00:00+00:00",
    };
    await act(async () => {
      await result.current.createMutation.mutateAsync(entry);
      await result.current.updateMutation.mutateAsync({
        entry,
        input: { ...entry, title: "Updated" },
      });
      await result.current.deleteMutation.mutateAsync(entry);
    });
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: ["calendar", "profile-1", "entries"],
      exact: true,
    });
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["calendar", "profile-1", "birthdays"],
    }));
  });

  it("refreshes entries after a stale result without treating it as success", async () => {
    mocks.updateCalendarEntry.mockResolvedValue({
      ok: false,
      error: { code: "stale_entry", message: "Changed." },
    });
    const { result, invalidate } = renderManagement();
    const entry = {
      id: "00000000-0000-4000-8000-000000000001",
      entryType: "event" as const,
      title: "Before",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      description: null,
      relatedUserId: null,
      updatedAt: "2026-10-01T00:00:00+00:00",
    };
    let response;
    await act(async () => {
      response = await result.current.updateMutation.mutateAsync({
        entry,
        input: { ...entry, title: "After" },
      });
    });
    expect(response).toMatchObject({ ok: false, error: { code: "stale_entry" } });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["calendar", "profile-1", "entries"],
      exact: true,
    });
  });
});
