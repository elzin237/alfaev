import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectDetailMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  isProjectId: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({
  useAuth: projectDetailMocks.useAuth,
}));
vi.mock("../services/projectService", () => ({
  getProject: projectDetailMocks.getProject,
  isProjectId: projectDetailMocks.isProjectId,
}));

import { projectDetailQueryKey, projectListQueryKey } from "../projectQueryKeys";
import { useProjectDetail } from "./useProjectDetail";

const projectId = "00000000-0000-4000-8000-000000000001";

function renderProjectDetailHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(() => useProjectDetail(projectId), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  projectDetailMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  projectDetailMocks.isProjectId.mockReturnValue(true);
  projectDetailMocks.getProject.mockResolvedValue({
    ok: false,
    error: {
      code: "project_not_found",
      message: "The Project could not be found.",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useProjectDetail", () => {
  it("uses a deterministic identity- and Project-scoped detail query", async () => {
    const { result, queryClient } = renderProjectDetailHook();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(projectDetailMocks.getProject).toHaveBeenCalledWith(projectId);
    expect(queryClient.getQueryData([
      "projects",
      "detail",
      "profile-1",
      projectId,
    ])).toMatchObject({ ok: false, error: { code: "project_not_found" } });
  });

  it("does not query without a profile or with a malformed Project UUID", () => {
    projectDetailMocks.useAuth.mockReturnValue({ profile: null });
    const missingProfile = renderProjectDetailHook();
    expect(missingProfile.result.current.fetchStatus).toBe("idle");
    missingProfile.unmount();

    projectDetailMocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
    projectDetailMocks.isProjectId.mockReturnValue(false);
    const malformedId = renderProjectDetailHook();
    expect(malformedId.result.current.fetchStatus).toBe("idle");

    expect(projectDetailMocks.getProject).not.toHaveBeenCalled();
  });

  it("keeps detail and list query namespaces distinct", () => {
    expect(projectDetailQueryKey("profile-1", projectId)).not.toEqual(
      projectListQueryKey("profile-1"),
    );
    expect(projectDetailQueryKey("profile-1", projectId)).toEqual([
      "projects",
      "detail",
      "profile-1",
      projectId,
    ]);
  });
});
