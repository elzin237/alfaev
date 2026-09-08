import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDetailPageMocks = vi.hoisted(() => ({
  getUserAdmin: vi.fn(),
  getUserPermissionsAdmin: vi.fn(),
  setUserActiveStateAdmin: vi.fn(),
  setUserAdminStatus: vi.fn(),
  updateUserProfileAdmin: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: userDetailPageMocks.useAuth,
}));
vi.mock("./services/userDetailService", () => ({
  getUserAdmin: userDetailPageMocks.getUserAdmin,
}));
vi.mock("./services/userPermissionsService", () => ({
  getUserPermissionsAdmin: userDetailPageMocks.getUserPermissionsAdmin,
}));
vi.mock("./services/userProfileUpdateService", () => ({
  updateUserProfileAdmin: userDetailPageMocks.updateUserProfileAdmin,
}));
vi.mock("./services/userActiveStateService", () => ({
  setUserActiveStateAdmin: userDetailPageMocks.setUserActiveStateAdmin,
}));
vi.mock("./services/userAdminStatusService", () => ({
  setUserAdminStatus: userDetailPageMocks.setUserAdminStatus,
}));

import type { AuthState } from "../../app/auth/AuthProvider";
import type { UserProfile } from "../../app/auth/profileService";
import UserDetailPage from "./UserDetailPage";
import type {
  AdminUserDetail,
  UserDetailResult,
} from "./services/userDetailService";
import type {
  UserPermissionMatrixItem,
  UserPermissionsResult,
} from "./services/userPermissionsService";

const routeUserId = "00000000-0000-0000-0000-000000000201";
const authUser: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-07T00:00:00.000Z",
};
const session: Session = {
  access_token: "user-detail-access-token",
  token_type: "bearer",
  expires_in: 3_600,
  refresh_token: "user-detail-refresh-token",
  user: authUser,
};
const profile: UserProfile = {
  id: "00000000-0000-0000-0000-000000000101",
  authUserId: authUser.id,
  fullName: "Ada Admin",
  email: "ada@example.com",
  birthday: "1990-01-01",
  isAdmin: true,
  isActive: true,
  createdAt: "2026-09-07T00:00:00.000Z",
  lastLoginAt: null,
};
const detail: AdminUserDetail = {
  id: routeUserId,
  fullName: "Ina Worker",
  email: "ina@example.com",
  birthday: "1994-06-07",
  isActive: false,
  isAdmin: false,
  createdAt: "2026-09-01T08:00:00.000Z",
  lastLoginAt: null,
};
const permissions: UserPermissionMatrixItem[] = [
  {
    permissionKey: "dashboard.view",
    module: "dashboard",
    label: "View Dashboard",
    description: "View the Dashboard.",
    granted: false,
  },
  {
    permissionKey: "projects.view",
    module: "projects",
    label: "View Projects",
    description: "View Projects.",
    granted: true,
  },
];

function authState(): AuthState {
  return {
    session,
    profile,
    isAdmin: true,
    isActive: true,
    isLoading: false,
    error: null,
  };
}

function renderUserDetailPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/users/${routeUserId}`]}>
        <Routes>
          <Route path="/users/:userId" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...rendered, queryClient };
}

function fillProfile(values: {
  fullName: string;
  email: string;
  birthday: string;
}) {
  fireEvent.change(screen.getByLabelText("Full Name"), {
    target: { value: values.fullName },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: values.email },
  });
  fireEvent.change(screen.getByLabelText("Birthday"), {
    target: { value: values.birthday },
  });
}

beforeEach(() => {
  userDetailPageMocks.useAuth.mockReturnValue(authState());
  userDetailPageMocks.getUserAdmin.mockResolvedValue({ ok: true, value: detail });
  userDetailPageMocks.getUserPermissionsAdmin.mockResolvedValue({
    ok: true,
    value: permissions,
  });
  userDetailPageMocks.updateUserProfileAdmin.mockResolvedValue({
    ok: true,
    value: { profileId: routeUserId },
  });
  userDetailPageMocks.setUserActiveStateAdmin.mockResolvedValue({
    ok: true,
    value: { profileId: routeUserId, isActive: true, changed: true },
  });
  userDetailPageMocks.setUserAdminStatus.mockResolvedValue({
    ok: true,
    value: { profileId: routeUserId, isAdmin: true },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("UserDetailPage", () => {
  it("renders LoadingState without profile content while detail is pending", async () => {
    let resolveDetail: ((value: UserDetailResult) => void) | undefined;
    const pendingDetail = new Promise<UserDetailResult>((resolve) => {
      resolveDetail = resolve;
    });
    userDetailPageMocks.getUserAdmin.mockReturnValue(pendingDetail);

    renderUserDetailPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading AlfaEV user profile...",
    );
    expect(screen.queryByLabelText("Full Name")).not.toBeInTheDocument();

    await act(async () => {
      resolveDetail?.({ ok: true, value: detail });
      await pendingDetail;
    });
  });

  it("renders a safe retriable error state", async () => {
    userDetailPageMocks.getUserAdmin.mockResolvedValue({
      ok: false,
      error: {
        code: "user_detail_failed",
        message: "The AlfaEV user profile could not be loaded.",
      },
    });

    renderUserDetailPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The AlfaEV user profile could not be loaded.",
    );
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("shows editable profile fields and read-only account information only", async () => {
    const { queryClient } = renderUserDetailPage();

    expect(await screen.findByLabelText("Full Name")).toHaveValue("Ina Worker");
    expect(screen.getByLabelText("Email")).toHaveValue("ina@example.com");
    expect(screen.getByLabelText("Birthday")).toHaveValue("1994-06-07");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Non-admin")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate User" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote to Admin" }))
      .toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Permissions" }))
      .toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "View Projects" }))
      .toBeChecked();
    expect(screen.getByRole("checkbox", { name: "View Dashboard" }))
      .not.toBeChecked();
    expect(screen.getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled")))
      .toBe(true);
    expect(userDetailPageMocks.getUserPermissionsAdmin).toHaveBeenCalledWith(
      routeUserId,
    );
    expect(
      queryClient.getQueryData([
        "users",
        "permissions",
        profile.id,
        routeUserId,
      ]),
    ).toEqual({ ok: true, value: permissions });
    expect(screen.queryByRole("button", { name: /save permissions/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /admin status|permission|password/i }))
      .not.toBeInTheDocument();
  });

  it("shows a focused loading state while the permission matrix is pending", async () => {
    let resolvePermissions: ((value: UserPermissionsResult) => void) | undefined;
    const pendingPermissions = new Promise<UserPermissionsResult>((resolve) => {
      resolvePermissions = resolve;
    });
    userDetailPageMocks.getUserPermissionsAdmin.mockReturnValue(
      pendingPermissions,
    );

    renderUserDetailPage();

    expect(await screen.findByLabelText("Full Name")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading user permissions...",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await act(async () => {
      resolvePermissions?.({ ok: true, value: permissions });
      await pendingPermissions;
    });
  });

  it("fails closed with a safe retriable permission-matrix error", async () => {
    userDetailPageMocks.getUserPermissionsAdmin.mockResolvedValue({
      ok: false,
      error: {
        code: "permission_matrix_failed",
        message: "The user's permissions could not be loaded.",
      },
    });

    renderUserDetailPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The user's permissions could not be loaded.",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" }))
      .toBeInTheDocument();
  });

  it("shows the read-only Admin bypass explanation for an Admin target", async () => {
    userDetailPageMocks.getUserAdmin.mockResolvedValue({
      ok: true,
      value: { ...detail, isAdmin: true },
    });

    renderUserDetailPage();

    expect(await screen.findByText(/full access through Admin bypass/i))
      .toBeInTheDocument();
    expect(screen.getByText(/become relevant again after demotion/i))
      .toBeInTheDocument();
  });

  it("refreshes detail and list data after a successful reactivation", async () => {
    const { queryClient } = renderUserDetailPage();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await screen.findByRole("button", { name: "Reactivate User" });
    fireEvent.click(screen.getByRole("button", { name: "Reactivate User" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reactivate User",
      }),
    );

    expect(await screen.findByText("User reactivated.")).toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "detail", profile.id, routeUserId],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "list", profile.id],
      exact: true,
    });
  });

  it("refreshes detail and list data after a successful promotion", async () => {
    const { queryClient } = renderUserDetailPage();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    await screen.findByRole("button", { name: "Promote to Admin" });
    fireEvent.click(screen.getByRole("button", { name: "Promote to Admin" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Promote to Admin",
      }),
    );

    expect(await screen.findByText("User promoted to Admin."))
      .toBeInTheDocument();
    expect(userDetailPageMocks.setUserAdminStatus).toHaveBeenCalledWith(
      routeUserId,
      true,
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "detail", profile.id, routeUserId],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "list", profile.id],
      exact: true,
    });
  });

  it("validates editable fields before calling the update service", async () => {
    renderUserDetailPage();
    await screen.findByLabelText("Full Name");
    fillProfile({ fullName: "", email: "invalid", birthday: "" });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(await screen.findByText("Full name is required.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Birthday is required.")).toBeInTheDocument();
    expect(userDetailPageMocks.updateUserProfileAdmin).not.toHaveBeenCalled();
  });

  it("saves normalized values and refreshes detail and list queries", async () => {
    const { queryClient } = renderUserDetailPage();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await screen.findByLabelText("Full Name");
    fillProfile({
      fullName: "  Ina   Updated  ",
      email: " INA.UPDATED@EXAMPLE.COM ",
      birthday: "1994-07-08",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => {
      expect(userDetailPageMocks.updateUserProfileAdmin).toHaveBeenCalledWith({
        userId: routeUserId,
        fullName: "Ina Updated",
        email: "ina.updated@example.com",
        birthday: "1994-07-08",
      });
    });
    expect(await screen.findByText("User profile updated."))
      .toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "detail", profile.id, routeUserId],
      exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["users", "list", profile.id],
      exact: true,
    });
  });

  it("keeps safe duplicate/backend errors visible", async () => {
    userDetailPageMocks.updateUserProfileAdmin.mockResolvedValue({
      ok: false,
      error: {
        code: "duplicate_user",
        message: "An AlfaEV user with this email already exists.",
      },
    });
    renderUserDetailPage();
    await screen.findByLabelText("Full Name");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "duplicate@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An AlfaEV user with this email already exists.",
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
