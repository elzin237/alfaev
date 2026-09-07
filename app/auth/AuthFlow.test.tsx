import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const authServiceMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
const authProviderMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock("./authService", () => authServiceMocks);
vi.mock("./AuthProvider", () => authProviderMocks);

import AuthGuard from "../guards/AuthGuard";
import LoginPage from "../../pages/auth/LoginPage";
import type { UserProfile } from "./profileService";

const user: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-07T00:00:00.000Z",
};

const session: Session = {
  access_token: "test-access-token",
  token_type: "bearer",
  expires_in: 3_600,
  expires_at: 1_788_739_200,
  refresh_token: "test-refresh-token",
  user,
};

const activeProfile: UserProfile = {
  id: "00000000-0000-0000-0000-000000000101",
  authUserId: user.id,
  fullName: "Active User",
  email: "active@example.com",
  birthday: "1990-01-01",
  isAdmin: false,
  isActive: true,
  createdAt: "2026-09-07T00:00:00.000Z",
  lastLoginAt: null,
};

const inactiveProfile: UserProfile = {
  ...activeProfile,
  fullName: "Inactive User",
  email: "inactive@example.com",
  isAdmin: true,
  isActive: false,
};

function renderLoginFlow() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthGuard />}>
          <Route path="/" element={<h1>Protected content</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function renderProtectedRoute() {
  return render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route path="/login" element={<h1>Login destination</h1>} />
        <Route element={<AuthGuard />}>
          <Route
            path="/protected"
            element={<h1>Protected content</h1>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Supabase login flow", () => {
  it("signs in and enters the protected route", async () => {
    authServiceMocks.signIn.mockResolvedValue({ ok: true, value: session });
    authProviderMocks.useAuth.mockReturnValue({
      session,
      profile: activeProfile,
      isAdmin: false,
      isActive: true,
      isLoading: false,
      error: null,
    });
    renderLoginFlow();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Lozinka"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prijava u sistem" }));

    expect(authServiceMocks.signIn).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "correct-password",
    });
    expect(
      await screen.findByRole("heading", { name: "Protected content" }),
    ).toBeInTheDocument();
  });

  it("shows the service-safe invalid-credentials error", async () => {
    authServiceMocks.signIn.mockResolvedValue({
      ok: false,
      error: {
        code: "invalid_credentials",
        message: "The email or password is incorrect.",
      },
    });
    authProviderMocks.useAuth.mockReturnValue({
      session: null,
      profile: null,
      isAdmin: false,
      isActive: false,
      isLoading: false,
      error: null,
    });
    renderLoginFlow();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Lozinka"), {
      target: { value: "incorrect-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prijava u sistem" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The email or password is incorrect.",
    );
    expect(screen.getByRole("heading", { name: "Prijava u sistem" }))
      .toBeInTheDocument();
  });

  it("blocks a successful sign-in when the loaded profile is inactive", async () => {
    authServiceMocks.signIn.mockResolvedValue({ ok: true, value: session });
    authServiceMocks.signOut.mockResolvedValue({
      ok: true,
      value: undefined,
    });
    authProviderMocks.useAuth.mockReturnValue({
      session,
      profile: inactiveProfile,
      isAdmin: true,
      isActive: false,
      isLoading: false,
      error: null,
    });
    renderLoginFlow();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "inactive@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Lozinka"), {
      target: { value: "valid-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prijava u sistem" }));

    expect(screen.queryByRole("heading", { name: "Protected content" }))
      .not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This AlfaEV account is inactive. Contact an administrator.",
    );
    expect(authServiceMocks.signOut).toHaveBeenCalledOnce();
  });
});

describe("AuthGuard centralized auth state", () => {
  it("redirects when centralized state has no session", async () => {
    authProviderMocks.useAuth.mockReturnValue({
      session: null,
      profile: null,
      isAdmin: false,
      isActive: false,
      isLoading: false,
      error: null,
    });
    renderProtectedRoute();

    expect(
      await screen.findByRole("heading", { name: "Login destination" }),
    ).toBeInTheDocument();
  });

  it("renders protected content for an active session with an active profile", async () => {
    authProviderMocks.useAuth.mockReturnValue({
      session,
      profile: activeProfile,
      isAdmin: false,
      isActive: true,
      isLoading: false,
      error: null,
    });
    renderProtectedRoute();

    expect(
      await screen.findByRole("heading", { name: "Protected content" }),
    ).toBeInTheDocument();
    expect(authProviderMocks.useAuth).toHaveBeenCalled();
  });

  it("fails closed with a safe error when a session has no loaded profile", () => {
    authProviderMocks.useAuth.mockReturnValue({
      session,
      profile: null,
      isAdmin: false,
      isActive: false,
      isLoading: false,
      error: null,
    });
    renderProtectedRoute();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No AlfaEV profile is linked to this account.",
    );
    expect(screen.queryByRole("heading", { name: "Protected content" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Login destination" }))
      .not.toBeInTheDocument();
    expect(authServiceMocks.signOut).not.toHaveBeenCalled();
  });

  it("renders the centralized safe session restore error and fails closed", () => {
    authProviderMocks.useAuth.mockReturnValue({
      session: null,
      profile: null,
      isAdmin: false,
      isActive: false,
      isLoading: false,
      error: {
        code: "session_restore_failed",
        message: "The authentication session could not be restored.",
      },
    });
    renderProtectedRoute();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The authentication session could not be restored.",
    );
    expect(screen.queryByRole("heading", { name: "Protected content" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Login destination" }))
      .not.toBeInTheDocument();
  });

  it("renders the centralized safe profile error and fails closed", () => {
    authProviderMocks.useAuth.mockReturnValue({
      session,
      profile: null,
      isAdmin: false,
      isActive: false,
      isLoading: false,
      error: {
        code: "profile_load_failed",
        message: "The AlfaEV profile could not be loaded.",
      },
    });
    renderProtectedRoute();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The AlfaEV profile could not be loaded.",
    );
    expect(screen.queryByRole("heading", { name: "Protected content" }))
      .not.toBeInTheDocument();
  });

  it("blocks a restored inactive session, signs out, and shows a safe login message", async () => {
    authServiceMocks.signOut.mockResolvedValue({
      ok: true,
      value: undefined,
    });
    authProviderMocks.useAuth.mockReturnValue({
      session,
      profile: inactiveProfile,
      isAdmin: true,
      isActive: false,
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route
              path="/protected"
              element={<h1>Protected content</h1>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("heading", { name: "Protected content" }))
      .not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This AlfaEV account is inactive. Contact an administrator.",
    );
    expect(authServiceMocks.signOut).toHaveBeenCalledOnce();
  });

  it("renders a loading state without protected content or redirect flicker", () => {
    authProviderMocks.useAuth.mockReturnValue({
      session,
      profile: null,
      isAdmin: false,
      isActive: false,
      isLoading: true,
      error: null,
    });
    renderProtectedRoute();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Restoring your AlfaEV session...",
    );
    expect(screen.queryByRole("heading", { name: "Protected content" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Login destination" }))
      .not.toBeInTheDocument();
  });
});
