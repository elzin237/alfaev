import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../guards/AuthGuard", () => ({ default: () => <Outlet /> }));
vi.mock("../auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../auth/permissionService", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("../../features/dashboard/DashboardPage", () => ({
  default: () => <h1>Dashboard route content</h1>,
}));

import AppRouter from "./AppRouter";

function authState(isAdmin = false) {
  return {
    session: { user: { id: "auth-user-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin,
  };
}

function renderDashboardRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <AppRouter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => mocks.useAuth.mockReturnValue(authState()));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Dashboard route", () => {
  it("allows an active Admin without a permission lookup", () => {
    mocks.useAuth.mockReturnValue(authState(true));
    renderDashboardRoute();

    expect(screen.getByRole("heading", { name: "Dashboard route content" }))
      .toBeInTheDocument();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows an active user with dashboard.view", async () => {
    mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    renderDashboardRoute();

    expect(await screen.findByRole("heading", { name: "Dashboard route content" }))
      .toBeInTheDocument();
    expect(mocks.hasPermission).toHaveBeenCalledExactlyOnceWith("dashboard.view");
  });

  it("blocks a user without dashboard.view", async () => {
    mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
    renderDashboardRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
    expect(screen.queryByRole("heading", { name: "Dashboard route content" }))
      .not.toBeInTheDocument();
    expect(mocks.hasPermission).toHaveBeenCalledExactlyOnceWith("dashboard.view");
  });
});
