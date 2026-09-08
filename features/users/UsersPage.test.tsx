import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usersPageMocks = vi.hoisted(() => ({
  listUsersAdmin: vi.fn(),
  inviteUserAdmin: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: usersPageMocks.useAuth,
}));
vi.mock("./services/usersService", () => ({
  listUsersAdmin: usersPageMocks.listUsersAdmin,
}));
vi.mock("./services/userInviteService", () => ({
  inviteUserAdmin: usersPageMocks.inviteUserAdmin,
}));

import UsersPage from "./UsersPage";
import type { AuthState } from "../../app/auth/AuthProvider";
import type { UsersListResult } from "./services/usersService";
import type { UserProfile } from "../../app/auth/profileService";

const user: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-07T00:00:00.000Z",
};

const session: Session = {
  access_token: "users-page-access-token",
  token_type: "bearer",
  expires_in: 3_600,
  refresh_token: "users-page-refresh-token",
  user,
};

const profile: UserProfile = {
  id: "00000000-0000-0000-0000-000000000101",
  authUserId: user.id,
  fullName: "Ada Admin",
  email: "ada@example.com",
  birthday: "1990-01-01",
  isAdmin: true,
  isActive: true,
  createdAt: "2026-09-07T00:00:00.000Z",
  lastLoginAt: null,
};

function createAuthState(): AuthState {
  return {
    session,
    profile,
    isAdmin: true,
    isActive: true,
    isLoading: false,
    error: null,
  };
}

function renderUsersPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...rendered, queryClient };
}

beforeEach(() => {
  usersPageMocks.useAuth.mockReturnValue(createAuthState());
  usersPageMocks.inviteUserAdmin.mockResolvedValue({
    ok: true,
    value: { profileId: "00000000-0000-0000-0000-000000000301" },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("UsersPage", () => {
  it("renders the shared loading state while the Admin list is pending", async () => {
    let resolveUsers: ((result: UsersListResult) => void) | undefined;
    const pendingUsers = new Promise<UsersListResult>((resolve) => {
      resolveUsers = resolve;
    });
    usersPageMocks.listUsersAdmin.mockReturnValue(pendingUsers);

    renderUsersPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading AlfaEV users...",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await act(async () => {
      resolveUsers?.({ ok: true, value: [] });
      await pendingUsers;
    });
  });

  it("renders a safe shared error state when the service fails", async () => {
    usersPageMocks.listUsersAdmin.mockResolvedValue({
      ok: false,
      error: {
        code: "users_list_failed",
        message: "The AlfaEV users list could not be loaded.",
      },
    });

    renderUsersPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The AlfaEV users list could not be loaded.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the shared empty state when no users exist", async () => {
    usersPageMocks.listUsersAdmin.mockResolvedValue({ ok: true, value: [] });

    renderUsersPage();

    expect(await screen.findByRole("heading", { name: "No users found" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the approved Users fields and readable statuses", async () => {
    usersPageMocks.listUsersAdmin.mockResolvedValue({
      ok: true,
      value: [
        {
          id: "00000000-0000-0000-0000-000000000201",
          fullName: "Ada Admin",
          email: "ada@example.com",
          isActive: true,
          isAdmin: true,
          createdAt: "2026-09-07T08:00:00.000Z",
          lastLoginAt: "2026-09-07T09:00:00.000Z",
        },
        {
          id: "00000000-0000-0000-0000-000000000202",
          fullName: "Ina Worker",
          email: "ina@example.com",
          isActive: false,
          isAdmin: false,
          createdAt: "2026-09-06T08:00:00.000Z",
          lastLoginAt: null,
        },
      ],
    });

    renderUsersPage();

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada Admin" })).toHaveAttribute(
      "href",
      "/users/00000000-0000-0000-0000-000000000201",
    );
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Ina Worker")).toBeInTheDocument();
    expect(screen.getByText("ina@example.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getAllByText("Admin")).toHaveLength(2);
    expect(screen.getByText("Non-admin")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(usersPageMocks.listUsersAdmin).toHaveBeenCalledOnce();
  });

  it("opens the Create User form from the page header action", async () => {
    usersPageMocks.listUsersAdmin.mockResolvedValue({ ok: true, value: [] });

    renderUsersPage();
    fireEvent.click(screen.getByRole("button", { name: "Create User" }));

    expect(screen.getByRole("dialog", { name: "Create User" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Full Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Birthday")).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("closes after success, confirms it, and refreshes the current Admin list", async () => {
    usersPageMocks.listUsersAdmin.mockResolvedValue({ ok: true, value: [] });
    const { queryClient } = renderUsersPage();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await screen.findByRole("heading", { name: "No users found" });
    fireEvent.click(screen.getByRole("button", { name: "Create User" }));
    fireEvent.change(screen.getByLabelText("Full Name"), {
      target: { value: "New AlfaEV User" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new.user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Birthday"), {
      target: { value: "1995-04-03" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Invitation" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "User invitation sent.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "list", profile.id],
      exact: true,
    });
    await waitFor(() => {
      expect(usersPageMocks.listUsersAdmin).toHaveBeenCalledTimes(2);
    });
  });
});
