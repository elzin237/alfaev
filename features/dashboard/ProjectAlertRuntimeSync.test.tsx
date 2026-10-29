import { StrictMode, type ReactNode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tracking:false,
  access: {
    profileId: "00000000-0000-4000-8000-000000000101" as string | null,
    canRead: true,
    permissionsPending: false,
  },
  auth: {
    session: {
      access_token: "current-jwt",
      user: { id: "00000000-0000-4000-8000-000000000001" },
    } as { access_token: string; user: { id: string } } | null,
    profile: {
      id: "00000000-0000-4000-8000-000000000101",
      isActive: true,
    } as { id: string; isActive: boolean } | null,
  },
  invalidate: vi.fn(),
  remove: vi.fn(),
  subscriptions: [] as Array<{
    active: boolean;
    options: {
      target?: "work_order";
      profileId: string;
      accessToken: string;
      onInvalidate: () => void;
      onStatusChange?: (status: string) => void;
    };
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
  useAuth: vi.fn(),
  useProjectAlertAccess: vi.fn(),
}));
vi.mock("../../app/config/workOrderActiveShortagesActivation",()=>({isWorkOrderActiveShortagesEnabled:()=>mocks.tracking}));

vi.mock("../../app/auth/AuthProvider", () => ({
  useAuth: mocks.useAuth,
}));
vi.mock("./hooks/useProjectAlerts", () => ({
  invalidateProjectAlertQueries: mocks.invalidate,
  removeProjectAlertQueries: mocks.remove,
  useProjectAlertAccess: mocks.useProjectAlertAccess,
}));
vi.mock("./services/projectAlertRealtimeService", () => ({
  subscribeToProjectAlertInvalidations: vi.fn((options) => {
    const entry = {
      active: true,
      options,
      unsubscribe: vi.fn(),
    };
    entry.unsubscribe.mockImplementation(() => {
      entry.active = false;
    });
    mocks.subscriptions.push(entry);
    return {
      getStatus: () => entry.active ? "subscribed" : "closed",
      unsubscribe: entry.unsubscribe,
    };
  }),
}));

import ProjectAlertRuntimeSync from "./ProjectAlertRuntimeSync";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  mocks.tracking=false;
  vi.resetAllMocks();
  mocks.subscriptions.length = 0;
  mocks.access = {
    profileId: "00000000-0000-4000-8000-000000000101",
    canRead: true,
    permissionsPending: false,
  };
  mocks.auth = {
    session: {
      access_token: "current-jwt",
      user: { id: "00000000-0000-4000-8000-000000000001" },
    },
    profile: {
      id: "00000000-0000-4000-8000-000000000101",
      isActive: true,
    },
  };
  mocks.useAuth.mockImplementation(() => mocks.auth);
  mocks.useProjectAlertAccess.mockImplementation(() => mocks.access);
  mocks.invalidate.mockResolvedValue(undefined);
});

afterEach(cleanup);

it("WO-08 subscribes to owner-scoped shortage invalidations only after activation and permission",async()=>{
  mocks.tracking=true;
  mocks.useProjectAlertAccess.mockReturnValue({...mocks.access,canReadWorkOrders:true,canReadProjects:true});
  const setup=createWrapper(),view=render(<ProjectAlertRuntimeSync/>,{wrapper:setup.Wrapper});
  expect(mocks.subscriptions).toHaveLength(2);
  expect(mocks.subscriptions[1]?.options).toMatchObject({target:"work_order",profileId:mocks.access.profileId});
  act(()=>mocks.subscriptions[1]?.options.onInvalidate());
  await waitFor(()=>expect(mocks.invalidate).toHaveBeenCalledWith(setup.queryClient,mocks.access.profileId));
  view.unmount();expect(mocks.subscriptions.every(s=>!s.active)).toBe(true);
});

describe("ProjectAlertRuntimeSync authorization and lifecycle", () => {
  it.each(["active Admin", "active authorized non-Admin"])(
    "creates one authorized private subscription for an %s",
    () => {
      const setup = createWrapper();
      render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });

      expect(mocks.subscriptions).toHaveLength(1);
      expect(mocks.subscriptions[0]?.options).toMatchObject({
        profileId: mocks.access.profileId,
        accessToken: "current-jwt",
      });
    },
  );

  it.each([
    ["anonymous", null, null, false],
    ["inactive", "profile", "profile", false],
    ["missing Dashboard access", "profile", "profile", false],
    ["missing Projects access", "profile", "profile", false],
  ])("does not subscribe for %s state", (_label, session, profile, canRead) => {
    mocks.auth.session = session ? {
      access_token: "current-jwt",
      user: { id: "00000000-0000-4000-8000-000000000001" },
    } : null;
    mocks.auth.profile = profile ? {
      id: "00000000-0000-4000-8000-000000000101",
      isActive: false,
    } : null;
    mocks.access = {
      profileId: profile ? "00000000-0000-4000-8000-000000000101" : null,
      canRead,
      permissionsPending: false,
    };
    const setup = createWrapper();
    render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });
    expect(mocks.subscriptions).toHaveLength(0);
  });

  it("keeps one subscription mounted across ordinary route-content changes", () => {
    const setup = createWrapper();
    const view = render(
      <>
        <ProjectAlertRuntimeSync />
        <span>Dashboard</span>
      </>,
      { wrapper: setup.Wrapper },
    );
    view.rerender(
      <>
        <ProjectAlertRuntimeSync />
        <span>Inventory</span>
      </>,
    );
    expect(mocks.subscriptions).toHaveLength(1);
    expect(mocks.subscriptions[0]?.active).toBe(true);
  });

  it("is StrictMode-safe with only one live channel", () => {
    const setup = createWrapper();
    render(
      <StrictMode>
        <ProjectAlertRuntimeSync />
      </StrictMode>,
      { wrapper: setup.Wrapper },
    );
    expect(mocks.subscriptions.filter((entry) => entry.active)).toHaveLength(1);
    for (const stale of mocks.subscriptions.slice(0, -1)) {
      expect(stale.unsubscribe).toHaveBeenCalledOnce();
      expect(stale.active).toBe(false);
    }
  });

  it("cleans up on logout and purges the captured profile cache", () => {
    const setup = createWrapper();
    const view = render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });
    const original = mocks.subscriptions[0];

    mocks.auth = { session: null, profile: null };
    mocks.access = { profileId: null, canRead: false, permissionsPending: false };
    view.rerender(<ProjectAlertRuntimeSync />);

    expect(original?.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith(
      setup.queryClient,
      "00000000-0000-4000-8000-000000000101",
    );
    expect(mocks.subscriptions.filter((entry) => entry.active)).toHaveLength(0);
  });

  it("isolates profile switches and ignores callbacks from the old generation", async () => {
    const setup = createWrapper();
    const view = render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });
    const oldSubscription = mocks.subscriptions[0];

    mocks.auth = {
      session: {
        access_token: "profile-two-jwt",
        user: { id: "00000000-0000-4000-8000-000000000002" },
      },
      profile: {
        id: "00000000-0000-4000-8000-000000000202",
        isActive: true,
      },
    };
    mocks.access = {
      profileId: "00000000-0000-4000-8000-000000000202",
      canRead: true,
      permissionsPending: false,
    };
    view.rerender(<ProjectAlertRuntimeSync />);
    mocks.invalidate.mockClear();

    oldSubscription?.options.onInvalidate();
    oldSubscription?.options.onStatusChange?.("subscribed");
    await act(async () => Promise.resolve());
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(oldSubscription?.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.subscriptions[mocks.subscriptions.length - 1]?.options.profileId).toBe(
      "00000000-0000-4000-8000-000000000202",
    );
  });

  it("unsubscribes and clears protected queries on permission revocation", () => {
    const setup = createWrapper();
    const view = render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });
    const subscription = mocks.subscriptions[0];
    mocks.access = {
      profileId: "00000000-0000-4000-8000-000000000101",
      canRead: false,
      permissionsPending: false,
    };
    view.rerender(<ProjectAlertRuntimeSync />);

    expect(subscription?.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith(
      setup.queryClient,
      "00000000-0000-4000-8000-000000000101",
    );
  });
});

describe("ProjectAlertRuntimeSync reconciliation", () => {
  it("reconciles on event and every successful subscribe/reconnect", async () => {
    const setup = createWrapper();
    render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });
    const callbacks = mocks.subscriptions[0]?.options;

    await act(async () => {
      callbacks?.onStatusChange?.("subscribed");
      await Promise.resolve();
    });
    expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith(
      setup.queryClient,
      "00000000-0000-4000-8000-000000000101",
    );

    await act(async () => {
      callbacks?.onInvalidate();
      await Promise.resolve();
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);

    await act(async () => {
      callbacks?.onStatusChange?.("subscribed");
      await Promise.resolve();
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });

  it("coalesces a burst into one trailing pass without losing the final event", async () => {
    const setup = createWrapper();
    const resolvers: Array<() => void> = [];
    mocks.invalidate.mockImplementation(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));
    render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });
    const callbacks = mocks.subscriptions[0]?.options;

    callbacks?.onInvalidate();
    callbacks?.onInvalidate();
    callbacks?.onInvalidate();
    expect(mocks.invalidate).toHaveBeenCalledOnce();

    await act(async () => {
      resolvers.shift()?.();
      await Promise.resolve();
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);

    callbacks?.onInvalidate();
    await act(async () => {
      resolvers.shift()?.();
      await Promise.resolve();
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolvers.shift()?.();
      await Promise.resolve();
    });
  });

  it("leaves cached data usable on channel errors and has no timer polling", async () => {
    const setup = createWrapper();
    render(<ProjectAlertRuntimeSync />, { wrapper: setup.Wrapper });
    const callbacks = mocks.subscriptions[0]?.options;
    callbacks?.onStatusChange?.("channel_error");
    callbacks?.onStatusChange?.("timed_out");
    await act(async () => Promise.resolve());

    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
