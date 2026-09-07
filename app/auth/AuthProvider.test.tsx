import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Session, Subscription, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authServiceMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  subscribeToAuthState: vi.fn(),
}));
const profileServiceMocks = vi.hoisted(() => ({
  loadUserProfile: vi.fn(),
}));

vi.mock("./authService", () => authServiceMocks);
vi.mock("./profileService", () => profileServiceMocks);

import AuthProvider, { useAuth } from "./AuthProvider";
import type { AuthStateCallback } from "./authService";
import type { ProfileServiceResult, UserProfile } from "./profileService";

const firstUserId = "00000000-0000-0000-0000-000000000001";
const secondUserId = "00000000-0000-0000-0000-000000000002";
let authStateCallback: AuthStateCallback | undefined;
let unsubscribe: () => void;

function createSession(userId: string): Session {
  const user: User = {
    id: userId,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-07T00:00:00.000Z",
  };

  return {
    access_token: `test-access-token-${userId}`,
    token_type: "bearer",
    expires_in: 3_600,
    expires_at: 1_788_739_200,
    refresh_token: `test-refresh-token-${userId}`,
    user,
  };
}

function createProfile(
  authUserId: string,
  overrides: Partial<UserProfile> = {},
): UserProfile {
  return {
    id: `profile-${authUserId}`,
    authUserId,
    fullName: "Ada Admin",
    email: "ada@example.com",
    birthday: "1990-01-01",
    isAdmin: true,
    isActive: true,
    createdAt: "2026-09-07T00:00:00.000Z",
    lastLoginAt: null,
    ...overrides,
  };
}

function AuthStateProbe() {
  const state = useAuth();

  return (
    <div>
      <span>session:{state.session ? "present" : "none"}</span>
      <span>profile:{state.profile?.fullName ?? "none"}</span>
      <span>admin:{String(state.isAdmin)}</span>
      <span>active:{String(state.isActive)}</span>
      <span>loading:{String(state.isLoading)}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <AuthStateProbe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  unsubscribe = vi.fn();
  authServiceMocks.subscribeToAuthState.mockImplementation(
    (callback: AuthStateCallback): Subscription => {
      authStateCallback = callback;
      return {
        id: "auth-provider-test",
        callback,
        unsubscribe,
      };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  authStateCallback = undefined;
});

describe("AuthProvider", () => {
  it("restores the session and loads its profile flags", async () => {
    const session = createSession(firstUserId);
    const profile = createProfile(firstUserId);
    authServiceMocks.getSession.mockResolvedValue({
      ok: true,
      value: session,
    });
    profileServiceMocks.loadUserProfile.mockResolvedValue({
      ok: true,
      value: profile,
    });

    renderProvider();

    expect(await screen.findByText("profile:Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("session:present")).toBeInTheDocument();
    expect(screen.getByText("admin:true")).toBeInTheDocument();
    expect(screen.getByText("active:true")).toBeInTheDocument();
    expect(screen.getByText("loading:false")).toBeInTheDocument();
    expect(profileServiceMocks.loadUserProfile).toHaveBeenCalledWith(
      firstUserId,
    );
  });

  it("clears session and profile when auth state is lost", async () => {
    const session = createSession(firstUserId);
    authServiceMocks.getSession.mockResolvedValue({
      ok: true,
      value: session,
    });
    profileServiceMocks.loadUserProfile.mockResolvedValue({
      ok: true,
      value: createProfile(firstUserId),
    });
    renderProvider();
    await screen.findByText("profile:Ada Admin");

    await act(async () => {
      authStateCallback?.("SIGNED_OUT", null);
      await Promise.resolve();
    });

    expect(await screen.findByText("session:none")).toBeInTheDocument();
    expect(screen.getByText("profile:none")).toBeInTheDocument();
    expect(screen.getByText("admin:false")).toBeInTheDocument();
    expect(screen.getByText("active:false")).toBeInTheDocument();
  });

  it("ignores a stale profile response after the actor changes", async () => {
    const firstSession = createSession(firstUserId);
    const secondSession = createSession(secondUserId);
    let resolveFirstProfile:
      | ((result: ProfileServiceResult) => void)
      | undefined;
    const firstProfileRequest = new Promise<ProfileServiceResult>((resolve) => {
      resolveFirstProfile = resolve;
    });
    authServiceMocks.getSession.mockResolvedValue({
      ok: true,
      value: firstSession,
    });
    profileServiceMocks.loadUserProfile
      .mockReturnValueOnce(firstProfileRequest)
      .mockResolvedValueOnce({
        ok: true,
        value: createProfile(secondUserId, {
          fullName: "Grace User",
          email: "grace@example.com",
          isAdmin: false,
          isActive: false,
        }),
      });
    renderProvider();
    await waitFor(() => {
      expect(profileServiceMocks.loadUserProfile).toHaveBeenCalledWith(
        firstUserId,
      );
    });

    await act(async () => {
      authStateCallback?.("SIGNED_IN", secondSession);
      await Promise.resolve();
    });

    expect(await screen.findByText("profile:Grace User")).toBeInTheDocument();
    expect(screen.getByText("session:present")).toBeInTheDocument();
    expect(screen.getByText("admin:false")).toBeInTheDocument();
    expect(screen.getByText("active:false")).toBeInTheDocument();

    await act(async () => {
      resolveFirstProfile?.({
        ok: true,
        value: createProfile(firstUserId),
      });
      await firstProfileRequest;
    });

    expect(screen.getByText("profile:Grace User")).toBeInTheDocument();
  });
});
