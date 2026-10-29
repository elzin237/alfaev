import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeSyncMocks = vi.hoisted(() => ({
  subscribeToUserPermissionChanges: vi.fn(),
  unsubscribe: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("./AuthProvider", () => ({
  useAuth: runtimeSyncMocks.useAuth,
}));
vi.mock("./permissionRealtimeService", () => ({
  subscribeToUserPermissionChanges:
    runtimeSyncMocks.subscribeToUserPermissionChanges,
}));

import PermissionRuntimeSync from "./PermissionRuntimeSync";
import type { AuthState } from "./AuthProvider";
import type { UserProfile } from "./profileService";

const user: User = {
  id: "00000000-0000-0000-0000-000000000001",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-08T00:00:00.000Z",
};
const session: Session = {
  access_token: "runtime-access-token",
  token_type: "bearer",
  expires_in: 3_600,
  refresh_token: "runtime-refresh-token",
  user,
};
const profile: UserProfile = {
  id: "00000000-0000-0000-0000-000000000101",
  authUserId: user.id,
  fullName: "Runtime User",
  email: "runtime@example.com",
  birthday: "1990-01-01",
  isAdmin: false,
  isActive: true,
  createdAt: "2026-09-08T00:00:00.000Z",
  lastLoginAt: null,
};

function authState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    session,
    profile,
    isAdmin: false,
    isActive: true,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  runtimeSyncMocks.useAuth.mockReturnValue(authState());
  runtimeSyncMocks.subscribeToUserPermissionChanges.mockReturnValue({
    unsubscribe: runtimeSyncMocks.unsubscribe,
  });
});

afterEach(cleanup);

describe("PermissionRuntimeSync", () => {
  it("invalidates only the current auth/profile permissions and Dashboard snapshot", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    render(<PermissionRuntimeSync />, {
      wrapper: createWrapper(queryClient),
    });

    expect(runtimeSyncMocks.subscribeToUserPermissionChanges)
      .toHaveBeenCalledWith(profile.id, expect.any(Function));
    const changeHandler =
      runtimeSyncMocks.subscribeToUserPermissionChanges.mock.calls[0]?.[1];

    if (typeof changeHandler !== "function") {
      throw new Error("Runtime permission-change handler was not registered");
    }

    await act(async () => {
      changeHandler();
      await Promise.resolve();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["permission", user.id, profile.id],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["dashboard", "read-model", profile.id], exact: true,
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes on identity change and does not subscribe for Admins", () => {
    const queryClient = new QueryClient();
    const view = render(<PermissionRuntimeSync />, {
      wrapper: createWrapper(queryClient),
    });

    runtimeSyncMocks.useAuth.mockReturnValue(
      authState({ isAdmin: true, profile: { ...profile, isAdmin: true } }),
    );
    view.rerender(<PermissionRuntimeSync />);

    expect(runtimeSyncMocks.unsubscribe).toHaveBeenCalledOnce();
    expect(runtimeSyncMocks.subscribeToUserPermissionChanges)
      .toHaveBeenCalledOnce();
  });

  it("does not subscribe without an active authenticated profile", () => {
    runtimeSyncMocks.useAuth.mockReturnValue(
      authState({ session: null, profile: null, isActive: false }),
    );

    render(<PermissionRuntimeSync />, {
      wrapper: createWrapper(new QueryClient()),
    });

    expect(runtimeSyncMocks.subscribeToUserPermissionChanges)
      .not.toHaveBeenCalled();
  });
});
