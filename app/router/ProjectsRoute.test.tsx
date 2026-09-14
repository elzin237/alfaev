import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const routeMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../auth/AuthProvider", () => ({ useAuth: routeMocks.useAuth }));
vi.mock("../auth/permissionService", () => ({
  hasPermission: routeMocks.hasPermission,
}));
vi.mock("../../features/projects/ProjectsPage", () => ({
  default: () => <h1>Projects route content</h1>,
}));
vi.mock("../../features/projects/ProjectDetailPage", () => ({
  default: () => <h1>Project detail route content</h1>,
}));

import AppRouter from "./AppRouter";

beforeEach(() => {
  routeMocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true, isAdmin: false },
    isAdmin: false,
    isActive: true,
    isLoading: false,
    error: null,
  });
  routeMocks.hasPermission.mockResolvedValue({ ok: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Projects route", () => {
  it("keeps /projects behind the canonical projects.view permission", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/projects"]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", {
      name: "Projects route content",
    })).toBeInTheDocument();
    await waitFor(() => expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      "projects.view",
    ));
  });

  it("protects /projects/:projectId with the same projects.view boundary", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[
          "/projects/00000000-0000-4000-8000-000000000001",
        ]}>
          <AppRouter />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", {
      name: "Project detail route content",
    })).toBeInTheDocument();
    await waitFor(() => expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      "projects.view",
    ));
  });
});
