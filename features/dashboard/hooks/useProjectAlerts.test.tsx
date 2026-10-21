import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markRead: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("../services/projectAlertService", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../services/projectAlertService")
  >();
  return {
    ...original,
    listProjectAlertNotifications: mocks.listNotifications,
    getProjectAlertUnreadCount: mocks.getUnreadCount,
    markProjectAlertRead: mocks.markRead,
    dismissProjectAlertNotification: mocks.dismiss,
  };
});

import {
  dedupeProjectAlertPages,
  getNextProjectAlertPageParam,
  type ProjectAlertInfiniteData,
  useDismissProjectAlertNotification,
  useMarkProjectAlertRead,
  useProjectAlertInbox,
  useProjectAlertUnreadCount,
} from "./useProjectAlerts";
import {
  projectAlertInboxQueryKey,
  projectAlertQueryPrefix,
  projectAlertUnreadCountQueryKey,
} from "../projectAlertQueryKeys";
import type {
  ProjectAlertNotification,
  ProjectAlertPage,
} from "../services/projectAlertService";

const profileOne = "00000000-0000-4000-8000-000000000001";
const profileTwo = "00000000-0000-4000-8000-000000000002";

function item(index: number): ProjectAlertNotification {
  return {
    notificationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    alertId: `00000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
    notificationKind: "activity",
    projectId: "00000000-0000-4000-8000-000000000010",
    projectName: "Alert Project",
    activityId: `00000000-0000-4000-8002-${String(index).padStart(12, "0")}`,
    activityTitle: `Activity ${index}`,
    activityAuthorFullName: "Historical Author",
    resolutionId: null,
    resolverFullName: null,
    resolvedAt: null,
    createdAt: `2026-10-19T10:${String(index).padStart(2, "0")}:00.000Z`,
    readAt: null,
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function auth(profileId = profileOne) {
  return {
    session: { user: { id: `auth-${profileId}` } },
    profile: { id: profileId, isActive: true },
    isActive: true,
    isAdmin: false,
  };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue(auth());
  mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
  mocks.listNotifications.mockResolvedValue({
    ok: true,
    value: { items: [], hasMore: false },
  });
  mocks.getUnreadCount.mockResolvedValue({
    ok: true,
    value: { exactValue: 0n, displayValue: "0", hasUnread: false },
  });
  mocks.markRead.mockResolvedValue({
    ok: true,
    value: {
      notificationId: item(1).notificationId,
      readAt: "2026-10-19T11:00:00.000Z",
    },
  });
  mocks.dismiss.mockResolvedValue({
    ok: true,
    value: {
      notificationId: item(1).notificationId,
      dismissedAt: "2026-10-19T11:00:00.000Z",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Project alert query keys and access", () => {
  it("uses exact required profile-scoped keys", () => {
    expect(projectAlertQueryPrefix(profileOne)).toEqual([
      "dashboard", "project-alerts", profileOne,
    ]);
    expect(projectAlertInboxQueryKey(profileOne)).toEqual([
      "dashboard", "project-alerts", profileOne, "inbox",
    ]);
    expect(projectAlertUnreadCountQueryKey(profileOne)).toEqual([
      "dashboard", "project-alerts", profileOne, "unread-count",
    ]);
  });

  it("gates inbox loading on panel-open state and both existing view permissions", async () => {
    const setup = createWrapper();
    const closed = renderHook(() => useProjectAlertInbox(false), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(closed.result.current.access.permissionsPending).toBe(false));
    expect(closed.result.current.access.canRead).toBe(true);
    expect(mocks.listNotifications).not.toHaveBeenCalled();
    closed.unmount();

    const deniedSetup = createWrapper();
    mocks.hasPermission.mockImplementation((permission: string) => Promise.resolve({
      ok: true,
      value: permission === "projects.view",
    }));
    const denied = renderHook(() => useProjectAlertInbox(true), {
      wrapper: deniedSetup.wrapper,
    });
    await waitFor(() => expect(denied.result.current.access.permissionsPending).toBe(false));
    expect(denied.result.current.access.canRead).toBe(false);
    expect(mocks.hasPermission).toHaveBeenCalledWith("dashboard.view");
    expect(mocks.hasPermission).toHaveBeenCalledWith("projects.view");
    expect(mocks.hasPermission).not.toHaveBeenCalledWith("projects.alerts.receive");
    expect(mocks.listNotifications).not.toHaveBeenCalled();
  });

  it("allows active Admin without permission RPCs and disables an inactive profile", async () => {
    mocks.useAuth.mockReturnValue({ ...auth(), isAdmin: true });
    const adminSetup = createWrapper();
    const admin = renderHook(() => useProjectAlertUnreadCount(), {
      wrapper: adminSetup.wrapper,
    });
    await waitFor(() => expect(mocks.getUnreadCount).toHaveBeenCalledOnce());
    expect(admin.result.current.access.canRead).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    admin.unmount();

    mocks.useAuth.mockReturnValue({
      ...auth(),
      profile: { id: profileOne, isActive: false },
      isActive: false,
      isAdmin: true,
    });
    mocks.getUnreadCount.mockClear();
    const inactiveSetup = createWrapper();
    const inactive = renderHook(() => useProjectAlertUnreadCount(), {
      wrapper: inactiveSetup.wrapper,
    });
    expect(inactive.result.current.access.canRead).toBe(false);
    expect(mocks.getUnreadCount).not.toHaveBeenCalled();
  });
});

describe("useProjectAlertInbox", () => {
  it("uses bounded keyset pages, exact next cursor, and cross-page deduplication", async () => {
    mocks.listNotifications
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [item(3), item(2)], hasMore: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [item(2), item(1)], hasMore: false },
      });
    const setup = createWrapper();
    const { result } = renderHook(() => useProjectAlertInbox(true), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(result.current.inboxQuery.isSuccess).toBe(true));
    expect(mocks.listNotifications).toHaveBeenCalledExactlyOnceWith(null);

    await act(async () => result.current.inboxQuery.fetchNextPage());
    expect(mocks.listNotifications).toHaveBeenLastCalledWith({
      createdAt: item(2).createdAt,
      notificationId: item(2).notificationId,
    });
    await waitFor(() => expect(result.current.items).toEqual([
      item(3), item(2), item(1),
    ]));
    expect(result.current.inboxQuery.hasNextPage).toBe(false);
  });

  it("does not create a looping cursor and deduplicates pure page models", () => {
    expect(getNextProjectAlertPageParam({ items: [], hasMore: true }))
      .toBeUndefined();
    expect(dedupeProjectAlertPages([
      { items: [item(3), item(2)], hasMore: true },
      { items: [item(2), item(1)], hasMore: false },
    ])).toEqual([item(3), item(2), item(1)]);
  });

  it("opts into focus refresh with zero stale/gc time and no polling", async () => {
    const setup = createWrapper();
    const rendered = renderHook(() => useProjectAlertInbox(true), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.inboxQuery.isSuccess).toBe(true));
    const query = setup.client.getQueryCache().find({
      queryKey: projectAlertInboxQueryKey(profileOne),
      exact: true,
    });
    expect(query?.options).toMatchObject({
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
    });
    expect("refetchInterval" in (query?.options ?? {})).toBe(false);
  });

  it("never renders the previous profile's rows while a new profile loads", async () => {
    let resolveSecond: ((value: unknown) => void) | undefined;
    mocks.listNotifications
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [item(1)], hasMore: false },
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));
    const setup = createWrapper();
    const rendered = renderHook(() => useProjectAlertInbox(true), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.items).toEqual([item(1)]));

    mocks.useAuth.mockReturnValue(auth(profileTwo));
    rendered.rerender();
    expect(rendered.result.current.items).toEqual([]);
    expect(rendered.result.current.inboxQuery.isPending).toBe(true);
    await waitFor(() => expect(mocks.listNotifications).toHaveBeenCalledTimes(2));

    await act(async () => resolveSecond?.({
      ok: true,
      value: { items: [item(2)], hasMore: false },
    }));
    await waitFor(() => expect(rendered.result.current.items).toEqual([item(2)]));
    expect(setup.client.getQueryData(projectAlertInboxQueryKey(profileOne)))
      .toBeUndefined();
  });

  it("purges and suppresses cached protected rows after backend authorization denial", async () => {
    const setup = createWrapper();
    const cached: InfiniteData<ProjectAlertPage, null> = {
      pages: [{ items: [item(1)], hasMore: false }],
      pageParams: [null],
    };
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), cached);
    mocks.listNotifications.mockResolvedValue({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      },
    });

    const rendered = renderHook(() => useProjectAlertInbox(true), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.inboxQuery.isError).toBe(true));
    expect(rendered.result.current.items).toEqual([]);
    await waitFor(() => expect(
      setup.client.getQueryData(projectAlertInboxQueryKey(profileOne)),
    ).toBeUndefined());
  });
});

describe("useProjectAlertUnreadCount", () => {
  it("loads independently with exact profile options and no polling", async () => {
    const setup = createWrapper();
    const rendered = renderHook(() => useProjectAlertUnreadCount(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.unreadCountQuery.isSuccess).toBe(true));
    expect(rendered.result.current.unreadCountQuery.data).toEqual({
      exactValue: 0n,
      displayValue: "0",
      hasUnread: false,
    });
    const query = setup.client.getQueryCache().find({
      queryKey: projectAlertUnreadCountQueryKey(profileOne),
      exact: true,
    });
    expect(query?.options).toMatchObject({
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
    });
    expect("refetchInterval" in (query?.options ?? {})).toBe(false);
  });
});

describe("useMarkProjectAlertRead", () => {
  it("marks only the requested ID and invalidates inbox plus unread count after success", async () => {
    const setup = createWrapper();
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const alreadyReadItem = {
      ...item(2),
      readAt: "2026-10-19T10:30:00.000Z",
    };
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), {
      pages: [{ items: [item(1), alreadyReadItem], hasMore: false }],
      pageParams: [null],
    });
    setup.client.setQueryData(projectAlertUnreadCountQueryKey(profileOne), {
      exactValue: 1n,
      displayValue: "1",
      hasUnread: true,
    });
    const rendered = renderHook(() => useMarkProjectAlertRead(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    await act(async () => {
      await rendered.result.current.markRead(item(1).notificationId);
    });
    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(item(1).notificationId);
    const reconciled = setup.client.getQueryData<ProjectAlertInfiniteData>(
      projectAlertInboxQueryKey(profileOne),
    );
    expect(reconciled?.pages[0]?.items).toEqual([
      { ...item(1), readAt: "2026-10-19T11:00:00.000Z" },
      alreadyReadItem,
    ]);
    expect(setup.client.getQueryData(projectAlertUnreadCountQueryKey(profileOne)))
      .toEqual({ exactValue: 0n, displayValue: "0", hasUnread: false });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey(profileOne),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey(profileOne),
      exact: true,
    });
  });

  it("refreshes both current-profile queries when the notification is unavailable", async () => {
    mocks.markRead.mockResolvedValue({
      ok: false,
      error: {
        code: "notification_unavailable",
        message: "This notification is no longer available.",
      },
    });
    const setup = createWrapper();
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const rendered = renderHook(() => useMarkProjectAlertRead(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    await act(async () => {
      await rendered.result.current.markRead(item(1).notificationId);
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey(profileOne),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey(profileOne),
      exact: true,
    });
  });

  it("reconciles and invalidates only the profile captured when the request began", async () => {
    let resolveMark: ((value: unknown) => void) | undefined;
    mocks.markRead.mockImplementation(() => new Promise((resolve) => {
      resolveMark = resolve;
    }));
    const setup = createWrapper();
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), {
      pages: [{ items: [item(1)], hasMore: false }],
      pageParams: [null],
    });
    setup.client.setQueryData(projectAlertInboxQueryKey(profileTwo), {
      pages: [{ items: [item(2)], hasMore: false }],
      pageParams: [null],
    });
    const rendered = renderHook(() => useMarkProjectAlertRead(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    let pending: Promise<unknown>;
    await act(async () => {
      pending = rendered.result.current.markRead(item(1).notificationId);
    });
    mocks.useAuth.mockReturnValue(auth(profileTwo));
    rendered.rerender();
    await act(async () => {
      resolveMark?.({
        ok: true,
        value: {
          notificationId: item(1).notificationId,
          readAt: "2026-10-19T11:00:00.000Z",
        },
      });
      await pending!;
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey(profileOne),
      exact: true,
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey(profileTwo),
      exact: true,
    });
    expect(setup.client.getQueryData<ProjectAlertInfiniteData>(
      projectAlertInboxQueryKey(profileTwo),
    )?.pages[0]?.items).toEqual([item(2)]);
  });

  it("guards duplicate pending submissions without optimistic cache mutation", async () => {
    let resolveMark: ((value: unknown) => void) | undefined;
    mocks.markRead.mockImplementation(() => new Promise((resolve) => {
      resolveMark = resolve;
    }));
    const setup = createWrapper();
    const cached: InfiniteData<ProjectAlertPage, null> = {
      pages: [{ items: [item(1)], hasMore: false }],
      pageParams: [null],
    };
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), cached);
    const rendered = renderHook(() => useMarkProjectAlertRead(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    let first: Promise<unknown>;
    await act(async () => {
      first = rendered.result.current.markRead(item(1).notificationId);
      const duplicate = await rendered.result.current.markRead(item(2).notificationId);
      expect(duplicate).toMatchObject({
        ok: false,
        error: { code: "request_pending" },
      });
    });
    expect(mocks.markRead).toHaveBeenCalledOnce();
    expect(setup.client.getQueryData(projectAlertInboxQueryKey(profileOne)))
      .toEqual(cached);

    await act(async () => {
      resolveMark?.({
        ok: true,
        value: {
          notificationId: item(1).notificationId,
          readAt: "2026-10-19T11:00:00.000Z",
        },
      });
      await first!;
    });
  });

  it("purges profile alert caches on authorization failure", async () => {
    mocks.markRead.mockResolvedValue({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      },
    });
    const setup = createWrapper();
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), {
      pages: [{ items: [item(1)], hasMore: false }],
      pageParams: [null],
    });
    setup.client.setQueryData(projectAlertUnreadCountQueryKey(profileOne), {
      exactValue: 1n,
      displayValue: "1",
      hasUnread: true,
    });
    const rendered = renderHook(() => useMarkProjectAlertRead(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));
    await act(async () => {
      await rendered.result.current.markRead(item(1).notificationId);
    });
    expect(setup.client.getQueriesData({
      queryKey: projectAlertQueryPrefix(profileOne),
    })).toEqual([]);
  });
});

describe("useDismissProjectAlertNotification", () => {
  it("removes only the confirmed row, decrements an unread count, and invalidates both queries", async () => {
    const setup = createWrapper();
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const alreadyReadItem = {
      ...item(2),
      readAt: "2026-10-19T10:30:00.000Z",
    };
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), {
      pages: [
        { items: [item(1), alreadyReadItem], hasMore: true },
        { items: [item(3)], hasMore: false },
      ],
      pageParams: [null, {
        createdAt: alreadyReadItem.createdAt,
        notificationId: alreadyReadItem.notificationId,
      }],
    });
    setup.client.setQueryData(projectAlertUnreadCountQueryKey(profileOne), {
      exactValue: 2n,
      displayValue: "2",
      hasUnread: true,
    });
    const rendered = renderHook(() => useDismissProjectAlertNotification(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    await act(async () => {
      await rendered.result.current.dismiss(item(1).notificationId);
    });

    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith(item(1).notificationId);
    const reconciled = setup.client.getQueryData<ProjectAlertInfiniteData>(
      projectAlertInboxQueryKey(profileOne),
    );
    expect(reconciled?.pages).toEqual([
      { items: [alreadyReadItem], hasMore: true },
      { items: [item(3)], hasMore: false },
    ]);
    expect(reconciled?.pageParams).toHaveLength(2);
    expect(setup.client.getQueryData(projectAlertUnreadCountQueryKey(profileOne)))
      .toEqual({ exactValue: 1n, displayValue: "1", hasUnread: true });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey(profileOne),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey(profileOne),
      exact: true,
    });
  });

  it("preserves unread count when dismissing a read row", async () => {
    const setup = createWrapper();
    const readItem = { ...item(1), readAt: "2026-10-19T10:30:00.000Z" };
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), {
      pages: [{ items: [readItem], hasMore: false }],
      pageParams: [null],
    });
    setup.client.setQueryData(projectAlertUnreadCountQueryKey(profileOne), {
      exactValue: 5n,
      displayValue: "5",
      hasUnread: true,
    });
    const rendered = renderHook(() => useDismissProjectAlertNotification(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));
    await act(async () => {
      await rendered.result.current.dismiss(readItem.notificationId);
    });
    expect(setup.client.getQueryData(projectAlertUnreadCountQueryKey(profileOne)))
      .toEqual({ exactValue: 5n, displayValue: "5", hasUnread: true });
  });

  it("does not mutate cache before success and synchronously rejects duplicate dismissals", async () => {
    let resolveDismiss: ((value: unknown) => void) | undefined;
    mocks.dismiss.mockImplementation(() => new Promise((resolve) => {
      resolveDismiss = resolve;
    }));
    const setup = createWrapper();
    const cached: InfiniteData<ProjectAlertPage, null> = {
      pages: [{ items: [item(1), item(2)], hasMore: false }],
      pageParams: [null],
    };
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), cached);
    const rendered = renderHook(() => useDismissProjectAlertNotification(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    let first: Promise<unknown>;
    await act(async () => {
      first = rendered.result.current.dismiss(item(1).notificationId);
      const duplicate = await rendered.result.current.dismiss(item(2).notificationId);
      expect(duplicate).toMatchObject({
        ok: false,
        error: { code: "request_pending" },
      });
    });
    expect(mocks.dismiss).toHaveBeenCalledOnce();
    expect(setup.client.getQueryData(projectAlertInboxQueryKey(profileOne)))
      .toEqual(cached);

    await act(async () => {
      resolveDismiss?.({
        ok: true,
        value: {
          notificationId: item(1).notificationId,
          dismissedAt: "2026-10-19T11:00:00.000Z",
        },
      });
      await first!;
    });
  });

  it("purges on 42501, refetches on P0002, and leaves rows unchanged on network failure", async () => {
    const setup = createWrapper();
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const cached = {
      pages: [{ items: [item(1)], hasMore: false }],
      pageParams: [null],
    };
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), cached);
    setup.client.setQueryData(projectAlertUnreadCountQueryKey(profileOne), {
      exactValue: 1n,
      displayValue: "1",
      hasUnread: true,
    });
    const rendered = renderHook(() => useDismissProjectAlertNotification(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    mocks.dismiss.mockResolvedValueOnce({
      ok: false,
      error: { code: "dismiss_failed", message: "Safe retry message" },
    });
    await act(async () => {
      await rendered.result.current.dismiss(item(1).notificationId);
    });
    expect(setup.client.getQueryData(projectAlertInboxQueryKey(profileOne)))
      .toEqual(cached);

    mocks.dismiss.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "notification_unavailable",
        message: "This notification is no longer available.",
      },
    });
    await act(async () => {
      await rendered.result.current.dismiss(item(1).notificationId);
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey(profileOne),
      exact: true,
    });

    mocks.dismiss.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have access to Project alerts.",
      },
    });
    await act(async () => {
      await rendered.result.current.dismiss(item(1).notificationId);
    });
    expect(setup.client.getQueriesData({
      queryKey: projectAlertQueryPrefix(profileOne),
    })).toEqual([]);
  });

  it("never updates a new profile's cache when an old-profile request resolves", async () => {
    let resolveDismiss: ((value: unknown) => void) | undefined;
    mocks.dismiss.mockImplementation(() => new Promise((resolve) => {
      resolveDismiss = resolve;
    }));
    const setup = createWrapper();
    setup.client.setQueryData(projectAlertInboxQueryKey(profileOne), {
      pages: [{ items: [item(1)], hasMore: false }],
      pageParams: [null],
    });
    setup.client.setQueryData(projectAlertInboxQueryKey(profileTwo), {
      pages: [{ items: [item(2)], hasMore: false }],
      pageParams: [null],
    });
    const rendered = renderHook(() => useDismissProjectAlertNotification(), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(rendered.result.current.access.canRead).toBe(true));

    let pending: Promise<unknown>;
    await act(async () => {
      pending = rendered.result.current.dismiss(item(1).notificationId);
    });
    mocks.useAuth.mockReturnValue(auth(profileTwo));
    rendered.rerender();
    await act(async () => {
      resolveDismiss?.({
        ok: true,
        value: {
          notificationId: item(1).notificationId,
          dismissedAt: "2026-10-19T11:00:00.000Z",
        },
      });
      await pending!;
    });
    expect(setup.client.getQueryData(projectAlertInboxQueryKey(profileOne)))
      .toBeUndefined();
    expect(setup.client.getQueryData<ProjectAlertInfiniteData>(
      projectAlertInboxQueryKey(profileTwo),
    )?.pages[0]?.items).toEqual([item(2)]);
  });
});
