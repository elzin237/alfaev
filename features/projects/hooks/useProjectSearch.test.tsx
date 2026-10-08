import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectSearchHookMocks = vi.hoisted(() => ({
  searchProjects: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: projectSearchHookMocks.useAuth,
}));
vi.mock("../services/projectService", () => ({
  searchProjects: projectSearchHookMocks.searchProjects,
}));

import { useProjectSearch } from "./useProjectSearch";

function renderSearchHook(search: string, enabled = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useProjectSearch(search, enabled), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  projectSearchHookMocks.useAuth.mockReturnValue({
    profile: { id: "profile-1" },
  });
  projectSearchHookMocks.searchProjects.mockResolvedValue({
    ok: true,
    value: [],
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProjectSearch", () => {
  it("normalizes and scopes bounded searches by profile and query", async () => {
    const { result, queryClient } = renderSearchHook("  Alpha  ");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(projectSearchHookMocks.searchProjects).toHaveBeenCalledExactlyOnceWith(
      "Alpha",
    );
    expect(queryClient.getQueryData([
      "projects",
      "search",
      "profile-1",
      "Alpha",
    ])).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["empty query", "", true, { id: "profile-1" }],
    ["whitespace query", "   ", true, { id: "profile-1" }],
    ["permission unavailable", "Alpha", false, { id: "profile-1" }],
    ["profile unavailable", "Alpha", true, null],
  ])("does not search for %s", (_label, search, enabled, profile) => {
    projectSearchHookMocks.useAuth.mockReturnValue({ profile });

    const { result } = renderSearchHook(search, enabled);

    expect(result.current.fetchStatus).toBe("idle");
    expect(projectSearchHookMocks.searchProjects).not.toHaveBeenCalled();
  });
});
