import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

const authServiceMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("./authService", () => authServiceMocks);

import AuthGuard from "../guards/AuthGuard";
import LoginPage from "../../pages/auth/LoginPage";

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
    authServiceMocks.getSession.mockResolvedValue({
      ok: true,
      value: session,
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
});

describe("AuthGuard compatibility bridge", () => {
  it("redirects after session lookup returns no session", async () => {
    authServiceMocks.getSession.mockResolvedValue({ ok: true, value: null });
    renderProtectedRoute();

    expect(
      await screen.findByRole("heading", { name: "Login destination" }),
    ).toBeInTheDocument();
  });

  it("renders protected content when a session exists", async () => {
    authServiceMocks.getSession.mockResolvedValue({
      ok: true,
      value: session,
    });
    renderProtectedRoute();

    expect(
      await screen.findByRole("heading", { name: "Protected content" }),
    ).toBeInTheDocument();
  });
});
