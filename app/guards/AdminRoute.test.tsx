import { cleanup, render, screen } from "@testing-library/react";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const routeMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: routeMocks.useAuth,
}));
vi.mock("../auth/permissionService", () => ({
  hasPermission: routeMocks.hasPermission,
}));

import AdminRoute from "./AdminRoute";
import AppRouter from "../router/AppRouter";
import type { AuthState } from "../auth/AuthProvider";
import type { UserProfile } from "../auth/profileService";

const user: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-07T00:00:00.000Z",
};

const session: Session = {
  access_token: "admin-route-access-token",
  token_type: "bearer",
  expires_in: 3_600,
  refresh_token: "admin-route-refresh-token",
  user,
};

const profile: UserProfile = {
  id: "00000000-0000-0000-0000-000000000101",
  authUserId: user.id,
  fullName: "Route User",
  email: "route@example.com",
  birthday: "1990-01-01",
  isAdmin: true,
  isActive: true,
  createdAt: "2026-09-07T00:00:00.000Z",
  lastLoginAt: null,
};

function createAuthState(
  overrides: Partial<AuthState> = {},
): AuthState {
  return {
    session,
    profile,
    isAdmin: true,
    isActive: true,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function renderAdminRoute() {
  return render(
    <MemoryRouter initialEntries={["/admin-only"]}>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route
            path="/admin-only"
            element={<h1>Admin-only content</h1>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  routeMocks.useAuth.mockReturnValue(createAuthState());
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("AdminRoute", () => {
  it("allows an active Admin to reach child content", () => {
    renderAdminRoute();

    expect(
      screen.getByRole("heading", { name: "Admin-only content" }),
    ).toBeInTheDocument();
    expect(routeMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("denies an active non-admin without using a permission RPC", () => {
    routeMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...profile, isAdmin: false },
        isAdmin: false,
      }),
    );

    renderAdminRoute();

    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to view this area.",
    );
    expect(screen.queryByRole("heading", { name: "Admin-only content" }))
      .not.toBeInTheDocument();
    expect(routeMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("fails closed when session or profile state is unavailable", () => {
    routeMocks.useAuth.mockReturnValue(
      createAuthState({
        session: null,
        profile: null,
        isAdmin: false,
        isActive: false,
      }),
    );

    renderAdminRoute();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your access could not be verified.",
    );
    expect(screen.queryByRole("heading", { name: "Admin-only content" }))
      .not.toBeInTheDocument();
  });

  it("wraps the Users route with the Admin-only boundary", () => {
    routeMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...profile, isAdmin: false },
        isAdmin: false,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/users"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    expect(screen.queryByText("Users Page")).not.toBeInTheDocument();
    expect(routeMocks.hasPermission).not.toHaveBeenCalled();
  });
});
