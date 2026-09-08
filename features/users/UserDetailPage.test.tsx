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
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDetailPageMocks = vi.hoisted(() => ({
  getUserAdmin: vi.fn(),
  updateUserProfileAdmin: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: userDetailPageMocks.useAuth,
}));
vi.mock("./services/userDetailService", () => ({
  getUserAdmin: userDetailPageMocks.getUserAdmin,
}));
vi.mock("./services/userProfileUpdateService", () => ({
  updateUserProfileAdmin: userDetailPageMocks.updateUserProfileAdmin,
}));

import type { AuthState } from "../../app/auth/AuthProvider";
import type { UserProfile } from "../../app/auth/profileService";
import UserDetailPage from "./UserDetailPage";
import type {
  AdminUserDetail,
  UserDetailResult,
} from "./services/userDetailService";

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
  userDetailPageMocks.updateUserProfileAdmin.mockResolvedValue({
    ok: true,
    value: { profileId: routeUserId },
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
    renderUserDetailPage();

    expect(await screen.findByLabelText("Full Name")).toHaveValue("Ina Worker");
    expect(screen.getByLabelText("Email")).toHaveValue("ina@example.com");
    expect(screen.getByLabelText("Birthday")).toHaveValue("1994-06-07");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Non-admin")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate|deactivate/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /admin status|permission|password/i }))
      .not.toBeInTheDocument();
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
    expect(await screen.findByRole("status")).toHaveTextContent(
      "User profile updated.",
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
