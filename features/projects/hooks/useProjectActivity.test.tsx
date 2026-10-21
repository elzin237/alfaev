import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  listProjectActivity: vi.fn(),
  getProjectActivity: vi.fn(),
  getProjectActivityImageAccess: vi.fn(),
  resolveProjectIssue: vi.fn(),
}));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../services/projectActivityService", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/projectActivityService")>();
  return {
    ...original,
    listProjectActivity: mocks.listProjectActivity,
    getProjectActivity: mocks.getProjectActivity,
    getProjectActivityImageAccess: mocks.getProjectActivityImageAccess,
    resolveProjectIssue: mocks.resolveProjectIssue,
  };
});

import {
  dedupeProjectActivityPages,
  getNextProjectActivityPageParam,
  useProjectActivity,
  useProjectActivityPermissions,
} from "./useProjectActivity";
import type { ProjectActivityItem } from "../services/projectActivityService";
import {
  projectActivityQueryKey,
  projectActivityTargetQueryKey,
} from "../projectActivityQueryKeys";
import {
  projectAlertInboxQueryKey,
  projectAlertUnreadCountQueryKey,
} from "../../dashboard/projectAlertQueryKeys";

const projectId = "00000000-0000-4000-8000-000000000001";
const item = (index: number): ProjectActivityItem => ({
  activityId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  projectId,
  authorUserId: "00000000-0000-4000-8000-000000000099",
  authorFullName: "Historical Actor",
  title: `Update ${index}`,
  description: "Description",
  activityKind: "general",
  createdAt: `2026-10-19T10:${String(index).padStart(2, "0")}:00.000Z`,
  alertSent: false,
  attachment: null,
  resolution: null,
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  mocks.listProjectActivity.mockResolvedValue({
    ok: true,
    value: { items: [], hasMore: false },
  });
  mocks.getProjectActivity.mockResolvedValue({ ok: true, value: item(9) });
  mocks.resolveProjectIssue.mockResolvedValue({
    ok: true,
    value: {
      resolutionId: "00000000-0000-4000-8000-000000000090",
      projectActivityId: item(9).activityId,
      projectId,
      requestId: "00000000-0000-4000-8000-000000000091",
      resolvedByUserId: "00000000-0000-4000-8000-000000000092",
      resolverFullName: "Resolver",
      description: "Resolved",
      resolvedAt: "2026-10-20T12:00:00.000Z",
      notificationId: "00000000-0000-4000-8000-000000000093",
      recipientCount: "2",
    },
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("useProjectActivity", () => {
  it("allows active Admin posting and alerting without permission RPCs", () => {
    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true },
      isAdmin: true,
    });
    const setup = wrapper();
    const { result } = renderHook(
      () => useProjectActivityPermissions("planned"),
      { wrapper: setup.wrapper },
    );
    expect(result.current.canPost).toBe(true);
    expect(result.current.canSendAlert).toBe(true);
    expect(result.current.canResolve).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
  });

  it("separates edit, alert-send, view-only, inactive, and closed lifecycle authority", async () => {
    mocks.hasPermission.mockImplementation((key: string) => Promise.resolve({
      ok: true,
      value: key === "projects.edit",
    }));
    const setup = wrapper();
    const editable = renderHook(
      () => useProjectActivityPermissions("planned"),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(editable.result.current.permissionsPending).toBe(false));
    expect(editable.result.current.canPost).toBe(true);
    expect(editable.result.current.canSendAlert).toBe(false);
    expect(editable.result.current.canResolve).toBe(true);
    expect(mocks.hasPermission).toHaveBeenCalledWith("projects.edit");
    expect(mocks.hasPermission).toHaveBeenCalledWith("projects.alerts.send");
    expect(mocks.hasPermission).not.toHaveBeenCalledWith("projects.alerts.receive");
    editable.unmount();

    mocks.hasPermission.mockResolvedValue({ ok: true, value: true });
    const closed = renderHook(
      () => useProjectActivityPermissions("completed"),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(closed.result.current.permissionsPending).toBe(false));
    expect(closed.result.current.canPost).toBe(false);
    expect(closed.result.current.canSendAlert).toBe(false);
    expect(closed.result.current.canResolve).toBe(true);
    closed.unmount();

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "inactive" } },
      profile: { id: "profile-inactive", isActive: false },
      isAdmin: true,
    });
    const inactive = renderHook(
      () => useProjectActivityPermissions("planned"),
      { wrapper: setup.wrapper },
    );
    expect(inactive.result.current.canPost).toBe(false);
    expect(inactive.result.current.canSendAlert).toBe(false);
    expect(inactive.result.current.canResolve).toBe(false);
  });

  it("uses 20-row keyset pages and exposes stable Load-more cursor behavior", async () => {
    mocks.listProjectActivity
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [item(2), item(1)], hasMore: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [item(1), item(0)], hasMore: false },
      });
    const setup = wrapper();
    const { result } = renderHook(() => useProjectActivity(projectId), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));
    expect(mocks.listProjectActivity).toHaveBeenCalledWith(projectId, null, 20);
    await result.current.activityQuery.fetchNextPage();
    await waitFor(() => expect(mocks.listProjectActivity).toHaveBeenCalledTimes(2));
    expect(mocks.listProjectActivity).toHaveBeenLastCalledWith(projectId, {
      createdAt: item(1).createdAt,
      activityId: item(1).activityId,
    }, 20);
    expect(result.current.items.map((row) => row.activityId)).toEqual([
      item(2).activityId,
      item(1).activityId,
      item(0).activityId,
    ]);
    expect(result.current.activityQuery.hasNextPage).toBe(false);
  });

  it("refuses empty looping cursors and deduplicates overlapping pages", () => {
    expect(getNextProjectActivityPageParam({ items: [], hasMore: true }))
      .toBeUndefined();
    expect(dedupeProjectActivityPages([
      { items: [item(2), item(1)], hasMore: true },
      { items: [item(1), item(0)], hasMore: false },
    ])).toEqual([item(2), item(1), item(0)]);
  });

  it("uses an already-loaded target without a by-ID request", async () => {
    mocks.listProjectActivity.mockResolvedValue({
      ok: true,
      value: { items: [item(2), item(1)], hasMore: true },
    });
    const setup = wrapper();
    const { result } = renderHook(
      () => useProjectActivity(projectId, item(1).activityId),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));
    expect(result.current.targetIsLoaded).toBe(true);
    expect(result.current.linkedActivity).toBeNull();
    expect(mocks.getProjectActivity).not.toHaveBeenCalled();
  });

  it("uses a target from cached later pages without a by-ID request", async () => {
    const setup = wrapper();
    setup.client.setQueryData(projectActivityQueryKey("profile-1", projectId), {
      pages: [
        { items: [item(2), item(1)], hasMore: true },
        { items: [item(0), item(9)], hasMore: false },
      ],
      pageParams: [null, {
        createdAt: item(1).createdAt,
        activityId: item(1).activityId,
      }],
    });
    const { result } = renderHook(
      () => useProjectActivity(projectId, item(9).activityId),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(result.current.targetIsLoaded).toBe(true));
    expect(result.current.items).toHaveLength(4);
    expect(result.current.linkedActivity).toBeNull();
    expect(mocks.getProjectActivity).not.toHaveBeenCalled();
  });

  it("fetches one absent target directly without walking timeline pages", async () => {
    mocks.listProjectActivity.mockResolvedValue({
      ok: true,
      value: { items: [item(2), item(1)], hasMore: true },
    });
    const setup = wrapper();
    const { result } = renderHook(
      () => useProjectActivity(projectId, item(9).activityId),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(result.current.linkedActivity).toEqual(item(9)));
    expect(mocks.getProjectActivity).toHaveBeenCalledExactlyOnceWith(
      projectId,
      item(9).activityId,
    );
    expect(mocks.listProjectActivity).toHaveBeenCalledExactlyOnceWith(
      projectId,
      null,
      20,
    );
    expect(setup.client.getQueryData(projectActivityTargetQueryKey(
      "profile-1",
      projectId,
      item(9).activityId,
    ))).toEqual({ ok: true, value: item(9) });
  });

  it("hides a directly loaded target when a later chronological page reaches it", async () => {
    mocks.listProjectActivity
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [item(2), item(1)], hasMore: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { items: [item(9), item(0)], hasMore: false },
      });
    const setup = wrapper();
    const { result } = renderHook(
      () => useProjectActivity(projectId, item(9).activityId),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(result.current.linkedActivity).toEqual(item(9)));

    await result.current.activityQuery.fetchNextPage();
    await waitFor(() => expect(result.current.targetIsLoaded).toBe(true));
    expect(result.current.linkedActivity).toBeNull();
    expect(result.current.items.map((row) => row.activityId)).toEqual([
      item(2).activityId,
      item(1).activityId,
      item(9).activityId,
      item(0).activityId,
    ]);
    expect(mocks.getProjectActivity).toHaveBeenCalledOnce();
  });

  it("isolates target data across hash, Project, and profile changes", async () => {
    const setup = wrapper();
    let activeProjectId = projectId;
    let activeTargetId: string | null = item(9).activityId;
    const { result, rerender } = renderHook(
      () => useProjectActivity(activeProjectId, activeTargetId),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(result.current.linkedActivity).toEqual(item(9)));

    activeTargetId = null;
    rerender();
    expect(result.current.linkedActivity).toBeNull();

    activeProjectId = "00000000-0000-4000-8000-000000000050";
    activeTargetId = item(8).activityId;
    mocks.getProjectActivity.mockResolvedValueOnce({ ok: true, value: item(8) });
    rerender();
    await waitFor(() => expect(mocks.getProjectActivity).toHaveBeenLastCalledWith(
      activeProjectId,
      item(8).activityId,
    ));

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-2" } },
      profile: { id: "profile-2", isActive: true },
      isAdmin: false,
    });
    mocks.getProjectActivity.mockResolvedValueOnce({ ok: true, value: item(8) });
    rerender();
    await waitFor(() => expect(mocks.getProjectActivity).toHaveBeenCalledTimes(3));
    expect(setup.client.getQueryData(projectActivityTargetQueryKey(
      "profile-2",
      activeProjectId,
      item(8).activityId,
    ))).toEqual({ ok: true, value: item(8) });
  });

  it("prepends the exact posted Activity immediately and reconciles without duplicates", async () => {
    mocks.listProjectActivity.mockResolvedValue({
      ok: true,
      value: { items: [item(2), item(1)], hasMore: false },
    });
    const setup = wrapper();
    const { result } = renderHook(() => useProjectActivity(projectId), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await act(async () => {
      await result.current.reconcilePostedActivity(item(9).activityId);
    });
    expect(mocks.getProjectActivity).toHaveBeenCalledExactlyOnceWith(
      projectId,
      item(9).activityId,
    );
    await waitFor(() => expect(
      result.current.items.map((row) => row.activityId),
    ).toEqual([
      item(9).activityId,
      item(2).activityId,
      item(1).activityId,
    ]));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectActivityQueryKey("profile-1", projectId),
      exact: true,
    });

    await act(async () => {
      await result.current.reconcilePostedActivity(item(9).activityId);
    });
    await waitFor(() => expect(result.current.items.filter(
      (row) => row.activityId === item(9).activityId,
    )).toHaveLength(1));
  });

  it("invalidates only the current profile alert inbox and unread count after an alert post", async () => {
    const setup = wrapper();
    const unreadKey = projectAlertUnreadCountQueryKey("profile-1");
    const originalUnread = {
      exactValue: 4n,
      displayValue: "4",
      hasUnread: true,
    };
    setup.client.setQueryData(unreadKey, originalUnread);
    const { result } = renderHook(() => useProjectActivity(projectId), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);

    await act(async () => {
      await result.current.reconcilePostedActivity(item(9).activityId, true);
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey("profile-1"),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: unreadKey,
      exact: true,
    });
    expect(setup.client.getQueryData(unreadKey)).toEqual(originalUnread);

    await act(async () => {
      await result.current.reconcilePostedActivity(item(9).activityId, true);
    });
    expect(setup.client.getQueryData(unreadKey)).toEqual(originalUnread);
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey("profile-2"),
      exact: true,
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey("profile-2"),
      exact: true,
    });

    invalidate.mockClear();
    await act(async () => {
      await result.current.reconcilePostedActivity(item(9).activityId, false);
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey("profile-1"),
      exact: true,
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey("profile-1"),
      exact: true,
    });
  });

  it("reconciles authoritative Issue resolution and current-profile notification queries", async () => {
    const openIssue = { ...item(9), activityKind: "issue" as const };
    const resolvedIssue = {
      ...openIssue,
      resolution: {
        resolutionId: "00000000-0000-4000-8000-000000000090",
        resolvedByUserId: "00000000-0000-4000-8000-000000000092",
        resolverFullName: "Resolver",
        description: "Resolved",
        resolvedAt: "2026-10-20T12:00:00.000Z",
        attachment: null,
      },
    };
    mocks.listProjectActivity.mockResolvedValue({
      ok: true,
      value: { items: [openIssue], hasMore: false },
    });
    mocks.getProjectActivity.mockResolvedValue({ ok: true, value: resolvedIssue });
    const setup = wrapper();
    const { result } = renderHook(() => useProjectActivity(projectId), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);
    const input = {
      activityId: openIssue.activityId,
      requestId: "00000000-0000-4000-8000-000000000091",
      description: "Resolved",
    };

    await act(async () => {
      await expect(result.current.resolveIssue(input)).resolves.toMatchObject({
        ok: true,
      });
    });
    expect(mocks.resolveProjectIssue).toHaveBeenCalledExactlyOnceWith(input);
    expect(mocks.getProjectActivity).toHaveBeenCalledWith(
      projectId,
      openIssue.activityId,
    );
    await waitFor(() => expect(result.current.items[0]?.resolution)
      .toEqual(resolvedIssue.resolution));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey("profile-1"),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey("profile-1"),
      exact: true,
    });
  });

  it("refreshes the Issue after a concurrent already-resolved response", async () => {
    mocks.resolveProjectIssue.mockResolvedValue({
      ok: false,
      error: { code: "already_resolved", message: "This Issue has already been resolved." },
    });
    const setup = wrapper();
    const { result } = renderHook(() => useProjectActivity(projectId), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));
    await act(async () => {
      await result.current.resolveIssue({
        activityId: item(9).activityId,
        requestId: "00000000-0000-4000-8000-000000000091",
        description: "Resolved elsewhere",
      });
    });
    expect(mocks.getProjectActivity).toHaveBeenCalledWith(
      projectId,
      item(9).activityId,
    );
  });

  it("refetches an active unread-count observer after authoritative alert success", async () => {
    const setup = wrapper();
    const unreadKey = projectAlertUnreadCountQueryKey("profile-1");
    const unreadFetch = vi.fn().mockResolvedValue({
      exactValue: 1n,
      displayValue: "1",
      hasUnread: true,
    });
    const observer = new QueryObserver(setup.client, {
      queryKey: unreadKey,
      queryFn: unreadFetch,
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(() => expect(unreadFetch).toHaveBeenCalledOnce());
    const { result } = renderHook(() => useProjectActivity(projectId), {
      wrapper: setup.wrapper,
    });
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));

    await act(async () => {
      await result.current.reconcilePostedActivity(item(9).activityId, true);
    });

    await waitFor(() => expect(unreadFetch).toHaveBeenCalledTimes(2));
    expect(setup.client.getQueryData(unreadKey)).toEqual({
      exactValue: 1n,
      displayValue: "1",
      hasUnread: true,
    });
    unsubscribe();
  });

  it("keeps alert invalidation bound to the profile that completed the post", async () => {
    const setup = wrapper();
    const { result, rerender } = renderHook(
      () => useProjectActivity(projectId),
      { wrapper: setup.wrapper },
    );
    await waitFor(() => expect(result.current.activityQuery.isSuccess).toBe(true));
    const reconcileForProfileOne = result.current.reconcilePostedActivity;
    const invalidate = vi.spyOn(setup.client, "invalidateQueries")
      .mockResolvedValue(undefined);

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "auth-2" } },
      profile: { id: "profile-2", isActive: true },
      isAdmin: false,
    });
    rerender();

    await act(async () => {
      await reconcileForProfileOne(item(9).activityId, true);
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey("profile-1"),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey("profile-1"),
      exact: true,
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: projectAlertInboxQueryKey("profile-2"),
      exact: true,
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: projectAlertUnreadCountQueryKey("profile-2"),
      exact: true,
    });
  });
});
