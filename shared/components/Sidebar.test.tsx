import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const sidebarMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: sidebarMocks.useAuth,
}));
vi.mock("../../app/auth/permissionService", () => ({
  hasPermission: sidebarMocks.hasPermission,
}));

import Sidebar from "./Sidebar";
import type { AuthState } from "../../app/auth/AuthProvider";
import type { PermissionServiceResult } from "../../app/auth/permissionService";
import type { UserProfile } from "../../app/auth/profileService";

const firstUser: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-07T00:00:00.000Z",
};

function createSession(user: User): Session {
  return {
    access_token: `sidebar-access-${user.id}`,
    token_type: "bearer",
    expires_in: 3_600,
    refresh_token: `sidebar-refresh-${user.id}`,
    user,
  };
}

function createProfile(user: User): UserProfile {
  return {
    id: `profile-${user.id}`,
    authUserId: user.id,
    fullName: "Sidebar User",
    email: "sidebar@example.com",
    birthday: "1990-01-01",
    isAdmin: false,
    isActive: true,
    createdAt: "2026-09-07T00:00:00.000Z",
    lastLoginAt: null,
  };
}

function createAuthState(
  overrides: Partial<AuthState> = {},
): AuthState {
  return {
    session: createSession(firstUser),
    profile: createProfile(firstUser),
    isAdmin: false,
    isActive: true,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSidebar(
  setSidebarOpen = vi.fn(),
  queryClient = createQueryClient(),
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar
          sidebarOpen={true}
          setSidebarOpen={setSidebarOpen}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient, setSidebarOpen };
}

beforeEach(() => {
  sidebarMocks.useAuth.mockReturnValue(createAuthState());
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Sidebar permission visibility", () => {
  it("shows all 10 canonical items to an active Admin immediately", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );

    renderSidebar();

    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual([
        "Dashboard",
        "Projects",
        "Nabavka",
        "Dobavljači",
        "Skladište",
        "PCB Cards",
        "Radni Nalozi",
        "Calendar",
        "Archive",
        "Users",
      ]);
    expect(sidebarMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("shows Calendar to an active non-admin without a Calendar permission check", () => {
    sidebarMocks.hasPermission.mockReturnValue(
      new Promise<PermissionServiceResult>(() => undefined),
    );

    renderSidebar();

    expect(screen.getByRole("link", { name: "Calendar" }))
      .toBeInTheDocument();
    expect(sidebarMocks.hasPermission).not.toHaveBeenCalledWith(
      "calendar.view",
    );
    expect(screen.queryByRole("link", { name: "Users" }))
      .not.toBeInTheDocument();
  });

  it("shows only granted permission-controlled modules to a non-admin", async () => {
    sidebarMocks.hasPermission.mockImplementation(
      async (permission: string): Promise<PermissionServiceResult> => ({
        ok: true,
        value: permission === "projects.view",
      }),
    );

    renderSidebar();

    expect(await screen.findByRole("link", { name: "Projects" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Calendar" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dashboard" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" }))
      .not.toBeInTheDocument();
  });

  it("does not expose ungranted links after permission checks resolve", async () => {
    sidebarMocks.hasPermission.mockResolvedValue({ ok: true, value: false });

    renderSidebar();

    await waitFor(() => {
      expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(8);
    });
    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Calendar"]);
  });

  it("does not expose permission-controlled links while checks are unresolved", () => {
    sidebarMocks.hasPermission.mockReturnValue(
      new Promise<PermissionServiceResult>(() => undefined),
    );

    renderSidebar();

    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Calendar"]);
  });

  it("fails closed per item when the permission service fails", async () => {
    sidebarMocks.hasPermission.mockResolvedValue({
      ok: false,
      error: {
        code: "permission_check_failed",
        message: "Your access could not be verified.",
      },
    });

    renderSidebar();

    await waitFor(() => {
      expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(8);
    });
    expect(screen.getAllByRole("link").map((link) => link.textContent))
      .toEqual(["Calendar"]);
  });

  it("does not expose module links without active authenticated profile state", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        session: null,
        profile: null,
        isActive: false,
      }),
    );

    renderSidebar();

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(sidebarMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("isolates cached permissions by authenticated user and profile", async () => {
    let permissionAllowed = true;
    sidebarMocks.hasPermission.mockImplementation(
      async (permission: string): Promise<PermissionServiceResult> => ({
        ok: true,
        value: permissionAllowed && permission === "projects.view",
      }),
    );
    const queryClient = createQueryClient();
    const firstView = renderSidebar(vi.fn(), queryClient);

    expect(await screen.findByRole("link", { name: "Projects" }))
      .toBeInTheDocument();
    firstView.unmount();

    const secondUser: User = {
      ...firstUser,
      id: "00000000-0000-0000-0000-000000000002",
    };
    permissionAllowed = false;
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        session: createSession(secondUser),
        profile: createProfile(secondUser),
      }),
    );
    renderSidebar(vi.fn(), queryClient);

    await waitFor(() => {
      expect(sidebarMocks.hasPermission).toHaveBeenCalledTimes(16);
    });
    expect(screen.queryByRole("link", { name: "Projects" }))
      .not.toBeInTheDocument();
    expect(
      queryClient.getQueryData([
        "permission",
        secondUser.id,
        `profile-${secondUser.id}`,
        "projects.view",
      ]),
    ).toEqual({ ok: true, value: false });
  });

  it("preserves close-on-navigation behavior", () => {
    sidebarMocks.useAuth.mockReturnValue(
      createAuthState({
        profile: { ...createProfile(firstUser), isAdmin: true },
        isAdmin: true,
      }),
    );
    const setSidebarOpen = vi.fn();

    renderSidebar(setSidebarOpen);
    fireEvent.click(screen.getByRole("link", { name: "Projects" }));

    expect(setSidebarOpen).toHaveBeenCalledWith(false);
  });
});
