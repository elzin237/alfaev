import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calendarHookMocks = vi.hoisted(() => ({
  listCalendarBirthdays: vi.fn(),
  listCalendarEntries: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: calendarHookMocks.useAuth,
}));
vi.mock("./calendarService", () => ({
  listCalendarBirthdays: calendarHookMocks.listCalendarBirthdays,
  listCalendarEntries: calendarHookMocks.listCalendarEntries,
}));

import { useCalendarData } from "./useCalendarData";

function renderCalendarHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useCalendarData(), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  calendarHookMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  calendarHookMocks.listCalendarEntries.mockResolvedValue({ ok: true, value: [] });
  calendarHookMocks.listCalendarBirthdays.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useCalendarData", () => {
  it("loads each source once under separate profile-scoped keys", async () => {
    const { result, queryClient, rerender } = renderCalendarHook();

    await waitFor(() => {
      expect(result.current.entriesQuery.isSuccess).toBe(true);
      expect(result.current.birthdaysQuery.isSuccess).toBe(true);
    });
    expect(calendarHookMocks.listCalendarEntries).toHaveBeenCalledOnce();
    expect(calendarHookMocks.listCalendarBirthdays).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(["calendar", "profile-1", "entries"]))
      .toEqual({ ok: true, value: [] });
    expect(queryClient.getQueryData(["calendar", "profile-1", "birthdays"]))
      .toEqual({ ok: true, value: [] });

    rerender();
    expect(calendarHookMocks.listCalendarEntries).toHaveBeenCalledOnce();
    expect(calendarHookMocks.listCalendarBirthdays).toHaveBeenCalledOnce();
  });

  it("does not read either Calendar source before a profile is available", () => {
    calendarHookMocks.useAuth.mockReturnValue({ profile: null });
    const { result } = renderCalendarHook();

    expect(result.current.entriesQuery.fetchStatus).toBe("idle");
    expect(result.current.birthdaysQuery.fetchStatus).toBe("idle");
    expect(calendarHookMocks.listCalendarEntries).not.toHaveBeenCalled();
    expect(calendarHookMocks.listCalendarBirthdays).not.toHaveBeenCalled();
  });
});
