import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { invalidateProjectAlertQueries } from "../../dashboard/hooks/useProjectAlerts";
import {
  projectActivityImageQueryKey,
  projectActivityQueryKey,
  projectActivityTargetQueryKey,
} from "../projectActivityQueryKeys";
import type { ProjectStatus } from "../projectStatus";
import {
  getProjectActivityImageAccess,
  getProjectActivity,
  listProjectActivity,
  PROJECT_ACTIVITY_PAGE_SIZE,
  type ProjectActivityCursor,
  type ProjectActivityItem,
  type ProjectActivityPage,
} from "../services/projectActivityService";

const writableStatuses = new Set<ProjectStatus>([
  "planned",
  "in_progress",
  "on_hold",
]);

export function getNextProjectActivityPageParam(
  lastPage: ProjectActivityPage,
): ProjectActivityCursor | undefined {
  if (!lastPage.hasMore) return undefined;
  const lastItem = lastPage.items[lastPage.items.length - 1];
  return lastItem
    ? { createdAt: lastItem.createdAt, activityId: lastItem.activityId }
    : undefined;
}

export function dedupeProjectActivityPages(
  pages: readonly ProjectActivityPage[] | undefined,
): ProjectActivityItem[] {
  const seen = new Set<string>();
  const items: ProjectActivityItem[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.activityId)) continue;
      seen.add(item.activityId);
      items.push(item);
    }
  }
  return items;
}

export function useProjectActivityPermissions(status: ProjectStatus) {
  const { session, profile, isAdmin } = useAuth();
  const permissionEnabled = Boolean(session && profile?.isActive && !isAdmin);
  const editPermissionQuery = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "projects.edit"),
    queryFn: () => hasPermission("projects.edit"),
    enabled: permissionEnabled,
    staleTime: 60_000,
  });
  const alertPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "projects.alerts.send",
    ),
    queryFn: () => hasPermission("projects.alerts.send"),
    enabled: permissionEnabled,
    staleTime: 60_000,
  });
  const active = profile?.isActive === true;
  const canEdit = active && (isAdmin || (
    editPermissionQuery.data?.ok === true && editPermissionQuery.data.value
  ));
  const canPost = Boolean(canEdit && writableStatuses.has(status));
  const canSendAlert = Boolean(canPost && (isAdmin || (
    alertPermissionQuery.data?.ok === true && alertPermissionQuery.data.value
  )));
  return {
    canPost,
    canSendAlert,
    permissionsPending: permissionEnabled && (
      editPermissionQuery.isPending || alertPermissionQuery.isPending
    ),
  };
}

export function useProjectActivity(
  projectId: string,
  targetActivityId: string | null = null,
) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = projectActivityQueryKey(profile?.id, projectId);
  const activityQuery = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const result = await listProjectActivity(
        projectId,
        pageParam,
        PROJECT_ACTIVITY_PAGE_SIZE,
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    initialPageParam: null as ProjectActivityCursor | null,
    getNextPageParam: getNextProjectActivityPageParam,
    enabled: Boolean(profile?.id && projectId),
    staleTime: 30_000,
    gcTime: 0,
  });
  const items = dedupeProjectActivityPages(activityQuery.data?.pages);
  const targetIsLoaded = activityQuery.isSuccess && targetActivityId !== null && items.some(
    (item) => item.activityId.toLowerCase() === targetActivityId.toLowerCase(),
  );
  const targetQuery = useQuery({
    queryKey: projectActivityTargetQueryKey(
      profile?.id,
      projectId,
      targetActivityId ?? "",
    ),
    queryFn: () => getProjectActivity(projectId, targetActivityId!),
    enabled: Boolean(
      profile?.id && targetActivityId && !activityQuery.isPending &&
        !targetIsLoaded,
    ),
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  async function reconcilePostedActivity(
    activityId: string,
    alertSent = false,
  ) {
    if (alertSent && profile?.id) {
      await invalidateProjectAlertQueries(queryClient, profile.id);
    }

    const result = await getProjectActivity(projectId, activityId);
    if (!result.ok) {
      void queryClient.invalidateQueries({ queryKey, exact: true });
      return null;
    }

    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<InfiniteData<
      ProjectActivityPage,
      ProjectActivityCursor | null
    >>(queryKey, (current) => {
      if (!current || current.pages.length === 0) {
        return {
          pages: [{ items: [result.value], hasMore: false }],
          pageParams: [null],
        };
      }
      const pages = current.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.activityId !== activityId),
      }));
      const firstPage = pages[0];
      if (!firstPage) return current;
      pages[0] = {
        ...firstPage,
        items: [result.value, ...firstPage.items],
      };
      return { ...current, pages };
    });
    void queryClient.invalidateQueries({ queryKey, exact: true });
    return result.value;
  }

  return {
    activityQuery,
    items,
    invalidate: () => queryClient.invalidateQueries({ queryKey, exact: true }),
    reconcilePostedActivity,
    targetIsLoaded,
    targetQuery,
    linkedActivity: !targetIsLoaded && targetQuery.data?.ok
      ? targetQuery.data.value
      : null,
    activityProfileId: profile?.id ?? null,
  };
}

export function useProjectActivityImage(
  projectId: string,
  activityId: string,
  enabled: boolean,
) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: projectActivityImageQueryKey(profile?.id, projectId, activityId),
    queryFn: async () => {
      const result = await getProjectActivityImageAccess(projectId, activityId);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    enabled: Boolean(enabled && profile?.id),
    staleTime: 240_000,
    gcTime: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
