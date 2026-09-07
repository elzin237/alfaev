import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const permissionServiceMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
}));
const authProviderMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock("../auth/permissionService", () => permissionServiceMocks);
vi.mock("../auth/AuthProvider", () => authProviderMocks);

import PermissionRoute from "./PermissionRoute";
import type { AuthState } from "../auth/AuthProvider";
import type { PermissionServiceResult } from "../auth/permissionService";
import type { PermissionKey } from "../auth/permissions";
import type { UserProfile } from "../auth/profileService";

const firstUser: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-07T00:00:00.000Z",
};

function createSession(user: User): Session {
  return {
    access_token: `access-${user.id}`,
    token_type: "bearer",
    expires_in: 3_600,
    refresh_token: `refresh-${user.id}`,
    user,
  };
}

function createProfile(user: User): UserProfile {
  return {
    id: `profile-${user.id}`,
    authUserId: user.id,
    fullName: "Permission User",
    email: "permission@example.com",
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

function renderPermissionRoute(
  permission: PermissionKey,
  queryClient = createQueryClient(),
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route element={<PermissionRoute permission={permission} />}>
            <Route
              path="/protected"
              element={<h1>Protected permission content</h1>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}

beforeEach(() => {
  authProviderMocks.useAuth.mockReturnValue(createAuthState());
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("PermissionRoute", () => {
  it("allows an Admin without requesting an explicit permission", () => {
    authProviderMocks.useAuth.mockReturnValue(
      createAuthState({ isAdmin: true }),
    );

    renderPermissionRoute("projects.view");

    expect(
      screen.getByRole("heading", { name: "Protected permission content" }),
    ).toBeInTheDocument();
    expect(permissionServiceMocks.hasPermission).not.toHaveBeenCalled();
  });

  it("allows a permitted non-admin", async () => {
    permissionServiceMocks.hasPermission.mockResolvedValue({
      ok: true,
      value: true,
    });

    renderPermissionRoute("projects.view");

    expect(
      await screen.findByRole("heading", {
        name: "Protected permission content",
      }),
    ).toBeInTheDocument();
    expect(permissionServiceMocks.hasPermission).toHaveBeenCalledWith(
      "projects.view",
    );
  });

  it("denies an unpermitted non-admin without rendering protected content", async () => {
    permissionServiceMocks.hasPermission.mockResolvedValue({
      ok: true,
      value: false,
    });

    renderPermissionRoute("projects.view");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Access denied",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to view this area.",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Protected permission content",
      }),
    ).not.toBeInTheDocument();
  });

  it("blocks protected content while the permission lookup is pending", async () => {
    let resolvePermission:
      | ((result: PermissionServiceResult) => void)
      | undefined;
    const pendingPermission = new Promise<PermissionServiceResult>(
      (resolve) => {
        resolvePermission = resolve;
      },
    );
    permissionServiceMocks.hasPermission.mockReturnValue(pendingPermission);

    renderPermissionRoute("projects.view");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your access...",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Protected permission content",
      }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolvePermission?.({ ok: true, value: true });
      await pendingPermission;
    });
  });

  it("fails closed with safe copy when permission lookup fails", async () => {
    permissionServiceMocks.hasPermission.mockResolvedValue({
      ok: false,
      error: {
        code: "permission_check_failed",
        message: "Your access could not be verified.",
      },
    });

    renderPermissionRoute("projects.view");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your access could not be verified.",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Protected permission content",
      }),
    ).not.toBeInTheDocument();
  });

  it("evaluates different permission keys independently", async () => {
    permissionServiceMocks.hasPermission.mockResolvedValue({
      ok: true,
      value: true,
    });
    const queryClient = createQueryClient();
    const firstView = renderPermissionRoute("projects.view", queryClient);

    await screen.findByRole("heading", {
      name: "Protected permission content",
    });
    firstView.unmount();
    renderPermissionRoute("procurement.view", queryClient);
    await screen.findByRole("heading", {
      name: "Protected permission content",
    });

    expect(permissionServiceMocks.hasPermission).toHaveBeenNthCalledWith(
      1,
      "projects.view",
    );
    expect(permissionServiceMocks.hasPermission).toHaveBeenNthCalledWith(
      2,
      "procurement.view",
    );
  });

  it("isolates cached checks by authenticated user and profile identity", async () => {
    permissionServiceMocks.hasPermission.mockResolvedValue({
      ok: true,
      value: true,
    });
    const queryClient = createQueryClient();
    const firstState = createAuthState();
    const firstView = renderPermissionRoute("projects.view", queryClient);

    await screen.findByRole("heading", {
      name: "Protected permission content",
    });
    firstView.unmount();

    const secondUser: User = {
      ...firstUser,
      id: "00000000-0000-0000-0000-000000000002",
    };
    const secondState = createAuthState({
      session: createSession(secondUser),
      profile: createProfile(secondUser),
    });
    authProviderMocks.useAuth.mockReturnValue(secondState);
    renderPermissionRoute("projects.view", queryClient);
    await screen.findByRole("heading", {
      name: "Protected permission content",
    });

    expect(permissionServiceMocks.hasPermission).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData([
        "permission",
        firstState.session?.user.id,
        firstState.profile?.id,
        "projects.view",
      ]),
    ).toEqual({ ok: true, value: true });
    expect(
      queryClient.getQueryData([
        "permission",
        secondState.session?.user.id,
        secondState.profile?.id,
        "projects.view",
      ]),
    ).toEqual({ ok: true, value: true });
  });
});
