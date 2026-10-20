import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import {
  projectAlertInboxQueryKey,
  projectAlertQueryPrefix,
  projectAlertUnreadCountQueryKey,
} from "../projectAlertQueryKeys";
import {
  dismissProjectAlertNotification,
  getProjectAlertUnreadCount,
  listProjectAlertNotifications,
  markProjectAlertRead,
  type ProjectAlertCursor,
  type ProjectAlertDismissReceipt,
  type ProjectAlertError,
  type ProjectAlertNotification,
  type ProjectAlertPage,
  type ProjectAlertReadReceipt,
  type ProjectAlertResult,
  type ProjectAlertUnreadCount,
} from "../services/projectAlertService";

const disabledInboxQueryKey = [
  "dashboard",
  "project-alerts",
  "inbox-disabled",
] as const;
const disabledUnreadCountQueryKey = [
  "dashboard",
  "project-alerts",
  "unread-count-disabled",
] as const;

export class ProjectAlertRequestError extends Error {
  readonly alertError: ProjectAlertError;

  constructor(error: ProjectAlertError) {
    super(error.message);
    this.name = "ProjectAlertRequestError";
    this.alertError = error;
  }
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof ProjectAlertRequestError &&
    error.alertError.code === "access_denied";
}

export function getNextProjectAlertPageParam(
  lastPage: ProjectAlertPage,
): ProjectAlertCursor | undefined {
  if (!lastPage.hasMore) return undefined;
  const lastItem = lastPage.items[lastPage.items.length - 1];
  return lastItem
    ? {
        createdAt: lastItem.createdAt,
        notificationId: lastItem.notificationId,
      }
    : undefined;
}

export function dedupeProjectAlertPages(
  pages: readonly ProjectAlertPage[] | undefined,
): ProjectAlertNotification[] {
  const seen = new Set<string>();
  const items: ProjectAlertNotification[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.notificationId)) continue;
      seen.add(item.notificationId);
      items.push(item);
    }
  }
  return items;
}

export async function invalidateProjectAlertQueries(
  queryClient: QueryClient,
  profileId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: projectAlertInboxQueryKey(profileId),
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: projectAlertUnreadCountQueryKey(profileId),
      exact: true,
    }),
  ]);
}

export function removeProjectAlertQueries(
  queryClient: QueryClient,
  profileId: string,
): void {
  queryClient.removeQueries({
    queryKey: projectAlertQueryPrefix(profileId),
  });
}

export function reconcileProjectAlertReadReceipt(
  queryClient: QueryClient,
  profileId: string,
  receipt: ProjectAlertReadReceipt,
): void {
  let changedUnreadNotification = false;
  queryClient.setQueryData<ProjectAlertInfiniteData>(
    projectAlertInboxQueryKey(profileId),
    (current) => {
      if (!current) return current;
      let changed = false;
      const pages = current.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => {
          if (item.notificationId !== receipt.notificationId) return item;
          changed = true;
          if (item.readAt === null) changedUnreadNotification = true;
          return { ...item, readAt: receipt.readAt };
        }),
      }));
      return changed ? { ...current, pages } : current;
    },
  );

  if (!changedUnreadNotification) return;
  queryClient.setQueryData<ProjectAlertUnreadCount>(
    projectAlertUnreadCountQueryKey(profileId),
    (current) => {
      if (!current || current.exactValue === null || current.exactValue === 0n) {
        return current;
      }
      const exactValue = current.exactValue - 1n;
      return {
        exactValue,
        displayValue: exactValue > 99n ? "99+" : exactValue.toString(),
        hasUnread: exactValue > 0n,
      };
    },
  );
}

export function reconcileProjectAlertDismissReceipt(
  queryClient: QueryClient,
  profileId: string,
  receipt: ProjectAlertDismissReceipt,
): void {
  let removedUnreadNotification = false;
  queryClient.setQueryData<ProjectAlertInfiniteData>(
    projectAlertInboxQueryKey(profileId),
    (current) => {
      if (!current) return current;
      let changed = false;
      const pages = current.pages.map((page) => {
        const items = page.items.filter((item) => {
          if (item.notificationId !== receipt.notificationId) return true;
          changed = true;
          if (item.readAt === null) removedUnreadNotification = true;
          return false;
        });
        return items.length === page.items.length ? page : { ...page, items };
      });
      return changed ? { ...current, pages } : current;
    },
  );

  if (!removedUnreadNotification) return;
  queryClient.setQueryData<ProjectAlertUnreadCount>(
    projectAlertUnreadCountQueryKey(profileId),
    (current) => {
      if (!current || current.exactValue === null || current.exactValue === 0n) {
        return current;
      }
      const exactValue = current.exactValue - 1n;
      return {
        exactValue,
        displayValue: exactValue > 99n ? "99+" : exactValue.toString(),
        hasUnread: exactValue > 0n,
      };
    },
  );
}

export function useProjectAlertAccess() {
  const { session, profile, isActive, isAdmin } = useAuth();
  const hasActiveProfile = Boolean(
    session && profile?.isActive && isActive,
  );
  const shouldCheckPermissions = hasActiveProfile && !isAdmin;
  const dashboardPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "dashboard.view",
    ),
    queryFn: () => hasPermission("dashboard.view"),
    enabled: shouldCheckPermissions,
    staleTime: 60_000,
  });
  const projectPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "projects.view",
    ),
    queryFn: () => hasPermission("projects.view"),
    enabled: shouldCheckPermissions,
    staleTime: 60_000,
  });
  const permissionsPending = shouldCheckPermissions && (
    dashboardPermissionQuery.isPending || projectPermissionQuery.isPending
  );
  const canRead = hasActiveProfile && (isAdmin || (
    dashboardPermissionQuery.data?.ok === true &&
    dashboardPermissionQuery.data.value &&
    projectPermissionQuery.data?.ok === true &&
    projectPermissionQuery.data.value
  ));

  return {
    profileId: hasActiveProfile ? profile?.id ?? null : null,
    canRead,
    permissionsPending,
  };
}

function useRemoveInaccessibleProjectAlerts(
  profileId: string | null,
  shouldRemove: boolean,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (profileId && shouldRemove) {
      removeProjectAlertQueries(queryClient, profileId);
    }
  }, [profileId, queryClient, shouldRemove]);
}

export function useProjectAlertInbox(panelOpen: boolean) {
  const access = useProjectAlertAccess();
  const enabled = Boolean(access.profileId && access.canRead && panelOpen);
  const inboxQuery = useInfiniteQuery({
    queryKey: access.profileId
      ? projectAlertInboxQueryKey(access.profileId)
      : disabledInboxQueryKey,
    queryFn: async ({ pageParam }) => {
      const result = await listProjectAlertNotifications(pageParam);
      if (!result.ok) throw new ProjectAlertRequestError(result.error);
      return result.value;
    },
    initialPageParam: null as ProjectAlertCursor | null,
    getNextPageParam: getNextProjectAlertPageParam,
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const deniedByPermission = Boolean(
    access.profileId && !access.permissionsPending && !access.canRead,
  );
  const deniedByBackend = isAccessDenied(inboxQuery.error);
  useRemoveInaccessibleProjectAlerts(
    access.profileId,
    deniedByPermission || deniedByBackend,
  );

  return {
    access,
    inboxQuery,
    items: deniedByBackend
      ? []
      : dedupeProjectAlertPages(inboxQuery.data?.pages),
  };
}

export function useProjectAlertUnreadCount() {
  const access = useProjectAlertAccess();
  const enabled = Boolean(access.profileId && access.canRead);
  const unreadCountQuery = useQuery({
    queryKey: access.profileId
      ? projectAlertUnreadCountQueryKey(access.profileId)
      : disabledUnreadCountQueryKey,
    queryFn: async () => {
      const result = await getProjectAlertUnreadCount();
      if (!result.ok) throw new ProjectAlertRequestError(result.error);
      return result.value;
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const deniedByPermission = Boolean(
    access.profileId && !access.permissionsPending && !access.canRead,
  );
  const deniedByBackend = isAccessDenied(unreadCountQuery.error);
  useRemoveInaccessibleProjectAlerts(
    access.profileId,
    deniedByPermission || deniedByBackend,
  );

  return { access, unreadCountQuery };
}

function pendingResult(): ProjectAlertResult<never> {
  return {
    ok: false,
    error: {
      code: "request_pending",
      message: "A notification update is already in progress.",
    },
  };
}

function deniedResult(): ProjectAlertResult<never> {
  return {
    ok: false,
    error: {
      code: "access_denied",
      message: "You no longer have access to Project alerts.",
    },
  };
}

export function useMarkProjectAlertRead() {
  const access = useProjectAlertAccess();
  const queryClient = useQueryClient();
  const operationLockRef = useRef(false);
  const [pendingNotificationId, setPendingNotificationId] = useState<
    string | null
  >(null);
  const mutation = useMutation({
    mutationFn: ({ notificationId }: { notificationId: string; profileId: string }) =>
      markProjectAlertRead(notificationId),
    onSuccess: async (result, request) => {
      if (result.ok) {
        reconcileProjectAlertReadReceipt(queryClient, request.profileId, result.value);
        await invalidateProjectAlertQueries(queryClient, request.profileId);
      } else if (result.error.code === "access_denied") {
        removeProjectAlertQueries(queryClient, request.profileId);
      } else if (result.error.code === "notification_unavailable") {
        await invalidateProjectAlertQueries(queryClient, request.profileId);
      }
    },
  });

  async function markRead(notificationId: string) {
    if (!access.profileId || !access.canRead) return deniedResult();
    if (operationLockRef.current) return pendingResult();
    operationLockRef.current = true;
    setPendingNotificationId(notificationId);
    try {
      return await mutation.mutateAsync({
        notificationId,
        profileId: access.profileId,
      });
    } finally {
      operationLockRef.current = false;
      setPendingNotificationId(null);
    }
  }

  return {
    access,
    markRead,
    isPending: mutation.isPending,
    pendingNotificationId,
  };
}

export function useDismissProjectAlertNotification() {
  const access = useProjectAlertAccess();
  const queryClient = useQueryClient();
  const operationLockRef = useRef(false);
  const currentProfileIdRef = useRef(access.profileId);
  const currentCanReadRef = useRef(access.canRead);
  currentProfileIdRef.current = access.profileId;
  currentCanReadRef.current = access.canRead;
  const [pendingNotificationId, setPendingNotificationId] = useState<
    string | null
  >(null);
  const mutation = useMutation({
    mutationFn: ({ notificationId }: { notificationId: string; profileId: string }) =>
      dismissProjectAlertNotification(notificationId),
    onSuccess: async (result, request) => {
      if (currentProfileIdRef.current !== request.profileId ||
        !currentCanReadRef.current) {
        removeProjectAlertQueries(queryClient, request.profileId);
        return;
      }
      if (result.ok) {
        reconcileProjectAlertDismissReceipt(queryClient, request.profileId, result.value);
        await invalidateProjectAlertQueries(queryClient, request.profileId);
      } else if (result.error.code === "access_denied") {
        removeProjectAlertQueries(queryClient, request.profileId);
      } else if (result.error.code === "notification_unavailable") {
        await invalidateProjectAlertQueries(queryClient, request.profileId);
      }
    },
  });

  async function dismiss(notificationId: string) {
    if (!access.profileId || !access.canRead) return deniedResult();
    if (operationLockRef.current) return pendingResult();
    operationLockRef.current = true;
    setPendingNotificationId(notificationId);
    try {
      return await mutation.mutateAsync({
        notificationId,
        profileId: access.profileId,
      });
    } finally {
      operationLockRef.current = false;
      setPendingNotificationId(null);
    }
  }

  return {
    access,
    dismiss,
    isPending: mutation.isPending,
    pendingNotificationId,
  };
}

export type ProjectAlertInfiniteData = InfiniteData<
  ProjectAlertPage,
  ProjectAlertCursor | null
>;
