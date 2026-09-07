import {
  AuthError,
  type Session,
  type Subscription,
  type User,
} from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../lib/supabase/client", () => ({
  supabase: { auth: authMocks },
}));

import {
  getSession,
  signIn,
  signOut,
  subscribeToAuthState,
  type AuthStateCallback,
} from "./authService";

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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("authService", () => {
  it("delegates password sign-in and returns the session", async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: { user, session },
      error: null,
    });

    const result = await signIn({
      email: "user@example.com",
      password: "password",
    });

    expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password",
    });
    expect(result).toEqual({ ok: true, value: session });
  });

  it("maps invalid credentials to an intentional service error", async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthError(
        "Raw provider message",
        400,
        "invalid_credentials",
      ),
    });

    const result = await signIn({
      email: "user@example.com",
      password: "incorrect",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_credentials",
        message: "The email or password is incorrect.",
      },
    });
  });

  it("delegates sign-out", async () => {
    authMocks.signOut.mockResolvedValue({ error: null });

    await expect(signOut()).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(authMocks.signOut).toHaveBeenCalledOnce();
  });

  it("returns the current Supabase session", async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    await expect(getSession()).resolves.toEqual({
      ok: true,
      value: session,
    });
    expect(authMocks.getSession).toHaveBeenCalledOnce();
  });

  it("returns the official subscription and supports unsubscribe", () => {
    const unsubscribe = vi.fn();
    const callback = vi.fn<AuthStateCallback>();
    const subscription: Subscription = {
      id: "auth-service-test",
      callback,
      unsubscribe,
    };

    authMocks.onAuthStateChange.mockReturnValue({
      data: { subscription },
    });

    const result = subscribeToAuthState(callback);

    expect(authMocks.onAuthStateChange).toHaveBeenCalledWith(callback);
    result.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
