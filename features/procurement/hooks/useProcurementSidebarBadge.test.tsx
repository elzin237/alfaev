import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const badgeHookMocks = vi.hoisted(() => ({
  getProcurementSidebarBadgeCount: vi.fn(),
}));

vi.mock("../services/procurementService", () => ({
  getProcurementSidebarBadgeCount:
    badgeHookMocks.getProcurementSidebarBadgeCount,
}));

import { useProcurementSidebarBadge } from "./useProcurementSidebarBadge";

function renderBadgeHook(enabled: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(
      () => useProcurementSidebarBadge("profile-1", enabled),
      { wrapper },
    ),
    queryClient,
  };
}

beforeEach(() => {
  badgeHookMocks.getProcurementSidebarBadgeCount.mockResolvedValue({
    ok: true,
    value: 3,
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProcurementSidebarBadge", () => {
  it("does not fetch protected count data while access is denied", () => {
    const { result } = renderBadgeHook(false);

    expect(result.current.fetchStatus).toBe("idle");
    expect(badgeHookMocks.getProcurementSidebarBadgeCount)
      .not.toHaveBeenCalled();
  });

  it("uses the current profile-scoped badge query when authorized", async () => {
    const { result, queryClient } = renderBadgeHook(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData([
      "procurement",
      "profile-1",
      "badge",
    ])).toEqual({ ok: true, value: 3 });
  });
});
