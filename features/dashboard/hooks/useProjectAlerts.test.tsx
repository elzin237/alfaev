import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
  type InfiniteData,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeTracking:false,
  workOrderAlertsEnabled: false,
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markRead: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../../app/config/workOrderActiveShortagesActivation",()=>({isWorkOrderActiveShortagesEnabled:()=>mocks.activeTracking}));
vi.mock("../../../app/config/workOrderNotificationsActivation",()=>({
  isWorkOrderNotificationsEnabled:()=>mocks.workOrderAlertsEnabled,
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
  reconcileProjectAlertReadReceipt,
  reconcileProjectAlertDismissReceipt,
  getNextProjectAlertPageParam,
  invalidateProjectAlertQueries,
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
import { getDashboardAlertCount } from "../dashboardAlertCount";

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
    productId: null,
    productSerialNumber: null,
    productName: null,
    shortageEventType: null,
    shortageQuantity: null,
    isBaselineDetection: null,
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

it("WO-08 read receipts never decrement authoritative active counts or touch another profile",()=>{
  mocks.activeTracking=true;mocks.workOrderAlertsEnabled=true;
  const client=new QueryClient(),inboxKey=[...projectAlertInboxQueryKey(profileOne),"pw"],countKey=[...projectAlertUnreadCountQueryKey(profileOne),"pw"];
  client.setQueryData(inboxKey,{pages:[{items:[item(1)],hasMore:false}],pageParams:[null]});
  const counts={exactValue:2n,displayValue:"2",hasUnread:true,projectUnread:3n,asOf:"2026-10-29T10:00:00Z"};
  client.setQueryData(countKey,counts);client.setQueryData(projectAlertUnreadCountQueryKey(profileTwo),counts);
  reconcileProjectAlertReadReceipt(client,profileOne,{notificationId:item(1).notificationId,readAt:"2026-10-29T10:01:00Z"});
  expect(client.getQueryData(countKey)).toEqual(counts);
  expect(client.getQueryData(projectAlertUnreadCountQueryKey(profileTwo))).toEqual(counts);client.clear();
});

beforeEach(() => {
  mocks.activeTracking=false;
  mocks.workOrderAlertsEnabled=false;
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

it.each(["read","dismiss"] as const)("reconciles %s receipts in the matching permission-scoped inbox even if refresh fails",operation=>{
  mocks.workOrderAlertsEnabled=true;
  const {client}=createWrapper(),prefix=projectAlertInboxQueryKey(profileOne);
  const key=[...prefix,"pw"],otherScope=[...prefix,"p"],otherProfile=[...projectAlertInboxQueryKey(profileTwo),"pw"];
  const cache=(items:ProjectAlertNotification[])=>({pages:[{items,hasMore:false}],pageParams:[null]});
  client.setQueryData(key,cache([item(1),item(2)]));
  client.setQueryData(otherScope,cache([item(2)]));
  client.setQueryData(otherProfile,cache([item(1)]));
  client.setQueryData([...projectAlertUnreadCountQueryKey(profileOne),"pw"],{exactValue:2n,displayValue:"2",hasUnread:true});
  client.setQueryData([...projectAlertUnreadCountQueryKey(profileOne),"p"],{exactValue:1n,displayValue:"1",hasUnread:true});
  const stamp="2026-10-29T10:00:00.123456Z";
  if(operation==="read")reconcileProjectAlertReadReceipt(client,profileOne,{notificationId:item(1).notificationId,readAt:stamp});
  else reconcileProjectAlertDismissReceipt(client,profileOne,{notificationId:item(1).notificationId,dismissedAt:stamp});
  const items=client.getQueryData<ProjectAlertInfiniteData>(key)!.pages[0]!.items;
  if(operation==="read")expect(items[0]!.readAt).toBe(stamp);else expect(items).toEqual([item(2)]);
  expect(client.getQueryData([...projectAlertUnreadCountQueryKey(profileOne),"pw"])).toMatchObject({exactValue:1n});
  expect(client.getQueryData([...projectAlertUnreadCountQueryKey(profileOne),"p"])).toMatchObject({exactValue:1n});
  expect(client.getQueryData<ProjectAlertInfiniteData>(otherProfile)!.pages[0]!.items).toEqual([item(1)]);
});

it("allows Dashboard plus Work Order viewers without Project access and scopes their inbox",async()=>{
  mocks.workOrderAlertsEnabled=true;
  mocks.hasPermission.mockImplementation(async(key:string)=>({ok:true,value:key!=="projects.view"}));
  const project=item(1);
  const workOrder:ProjectAlertNotification={notificationId:item(2).notificationId,alertId:project.alertId,targetType:"work_order",
    notificationKind:"work_order_shortage",projectId:null,projectName:null,workOrderId:project.projectId!,workOrderNumber:"RN-2026-0010",
    productId:project.alertId,productName:"Relay",shortageEventType:"opened",shortageQuantity:"5",createdAt:project.createdAt,
    readAt:null,activityId:null,activityTitle:null};
  mocks.listNotifications.mockResolvedValue({ok:true,value:{items:[project,workOrder],hasMore:false}});
  const {client,wrapper}=createWrapper();
  const {result}=renderHook(()=>useProjectAlertInbox(true),{wrapper});
  await waitFor(()=>expect(result.current.items).toEqual([workOrder]));
  expect(result.current.access.canReadProjects).toBe(false);
  expect(result.current.access.canReadWorkOrders).toBe(true);
  expect(client.getQueryData([...projectAlertInboxQueryKey(profileOne),"w"])).toBeDefined();
});

it("keeps Work Order permission requests and combined inbox reads off before activation",async()=>{
  const {wrapper}=createWrapper();renderHook(()=>useProjectAlertInbox(true),{wrapper});
  await waitFor(()=>expect(mocks.listNotifications).toHaveBeenCalled());
  expect(mocks.hasPermission).not.toHaveBeenCalledWith("work_orders.view");
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
  it("never carries either badge count into another profile or an inactive permission scope", async () => {
    mocks.activeTracking = true;
    mocks.workOrderAlertsEnabled = true;
    mocks.useAuth.mockReturnValue({ ...auth(), isAdmin: true });
    let releaseNewProfile: (() => void) | undefined;
    mocks.getUnreadCount.mockResolvedValueOnce({ ok: true, value: {
      exactValue: 1n, projectUnread: 2n, displayValue: "1", hasUnread: true,
    } }).mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseNewProfile = resolve; });
      return { ok: true, value: { exactValue: 0n, projectUnread: 1n, displayValue: "0", hasUnread: false } };
    });
    const setup = createWrapper();
    const view = renderHook(() => {
      const sidebar = useProjectAlertUnreadCount();
      const alerts = useProjectAlertUnreadCount();
      return [sidebar, alerts].map(({ access, unreadCountQuery }) =>
        getDashboardAlertCount(unreadCountQuery, true, access.canRead && !access.permissionsPending).badgeValue);
    }, { wrapper: setup.wrapper });
    try {
      await waitFor(() => expect(view.result.current).toEqual(["3", "3"]));
      mocks.useAuth.mockReturnValue({ ...auth(profileTwo), isAdmin: true });
      view.rerender();
      expect(view.result.current).toEqual([null, null]);
      await waitFor(() => expect(releaseNewProfile).toBeDefined());
      act(() => releaseNewProfile?.());
      await waitFor(() => expect(view.result.current).toEqual(["1", "1"]));
      expect(setup.client.getQueryCache().find({ queryKey: [...projectAlertUnreadCountQueryKey(profileTwo), "pw"], exact: true }))
        .toBeDefined();
      mocks.useAuth.mockReturnValue({ ...auth(profileTwo), isActive: false, isAdmin: true });
      view.rerender();
      expect(view.result.current).toEqual([null, null]);
    } finally {
      view.unmount(); setup.client.clear();
    }
  });

  it("shares one query across both badge observers and refreshes both after receipts, invalidation, focus and reconnect", async () => {
    mocks.activeTracking = true;
    mocks.workOrderAlertsEnabled = true;
    mocks.useAuth.mockReturnValue({ ...auth(), isAdmin: true });
    let active = 1n;
    let projects = 2n;
    mocks.getUnreadCount.mockImplementation(async () => ({ ok: true, value: {
      exactValue: active, projectUnread: projects, displayValue: active.toString(), hasUnread: active > 0n,
    } }));
    const setup = createWrapper();
    const view = renderHook(() => {
      const sidebar = useProjectAlertUnreadCount();
      const alerts = useProjectAlertUnreadCount();
      const read = useMarkProjectAlertRead();
      const dismiss = useDismissProjectAlertNotification();
      return {
        badges: [sidebar, alerts].map(({ access, unreadCountQuery }) =>
          getDashboardAlertCount(unreadCountQuery, true, access.canRead && !access.permissionsPending).badgeValue),
        read, dismiss,
      };
    }, { wrapper: setup.wrapper });
    try {
      await waitFor(() => expect(view.result.current.badges).toEqual(["3", "3"]));
      expect(mocks.getUnreadCount).toHaveBeenCalledTimes(1);
      expect(setup.client.getQueryCache().findAll({ queryKey: projectAlertUnreadCountQueryKey(profileOne) })).toHaveLength(1);

      projects = 1n;
      await act(async () => { await view.result.current.read.markRead(item(1).notificationId); });
      await waitFor(() => expect(view.result.current.badges).toEqual(["2", "2"]));
      await act(async () => { await view.result.current.read.markRead(item(1).notificationId); });
      await waitFor(() => expect(view.result.current.badges).toEqual(["2", "2"]));

      active = 0n; // Private shortage resolution invalidates the same scoped key.
      await act(async () => { await invalidateProjectAlertQueries(setup.client, profileOne); });
      await waitFor(() => expect(view.result.current.badges).toEqual(["1", "1"]));
      projects = 2n; // New Project notification arrives.
      await act(async () => { await invalidateProjectAlertQueries(setup.client, profileOne); });
      await waitFor(() => expect(view.result.current.badges).toEqual(["2", "2"]));
      projects = 1n;
      await act(async () => { await view.result.current.dismiss.dismiss(item(1).notificationId); });
      await waitFor(() => expect(view.result.current.badges).toEqual(["1", "1"]));

      projects = 2n;
      act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
      await waitFor(() => expect(view.result.current.badges).toEqual(["2", "2"]));
      projects = 0n;
      act(() => { onlineManager.setOnline(false); onlineManager.setOnline(true); });
      await waitFor(() => expect(view.result.current.badges).toEqual([null, null]));
      await waitFor(() => expect(mocks.getUnreadCount).toHaveBeenCalledTimes(8));
    } finally {
      view.unmount(); setup.client.clear();
      focusManager.setFocused(undefined); onlineManager.setOnline(true);
    }
  });

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
