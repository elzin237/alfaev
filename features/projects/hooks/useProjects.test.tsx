import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectHookMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: projectHookMocks.useAuth,
}));
vi.mock("../services/projectService", () => ({
  listProjects: projectHookMocks.listProjects,
}));

import { useProjects } from "./useProjects";

function renderProjectsHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useProjects(), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  projectHookMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  projectHookMocks.listProjects.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProjects", () => {
  it("uses one profile-scoped Projects list query", async () => {
    const { result, queryClient } = renderProjectsHook();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(projectHookMocks.listProjects).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(["projects", "list", "profile-1"]))
      .toEqual({ ok: true, value: [] });
  });

  it("does not read Projects without a loaded profile", () => {
    projectHookMocks.useAuth.mockReturnValue({ profile: null });

    const { result } = renderProjectsHook();

    expect(result.current.fetchStatus).toBe("idle");
    expect(projectHookMocks.listProjects).not.toHaveBeenCalled();
  });
});
