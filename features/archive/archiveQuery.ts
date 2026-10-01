import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useAuth } from "../../app/auth/AuthProvider";
import {
  ARCHIVE_PAGE_SIZE,
  getAuditLogFilterOptions,
  listAuditLogPage,
  type ArchiveAuditLogItem,
  type ArchiveCursor,
} from "./archiveService";
import { normalizeArchiveFilters, type ArchiveFilters } from "./archiveFilters";

export function archiveQueryKey(
  profileId: string | undefined,
  filters: ArchiveFilters,
) {
  const normalized = normalizeArchiveFilters(filters);
  return [
    "archive",
    "audit-log",
    profileId,
    normalized.createdFrom,
    normalized.createdBefore,
    normalized.actorUserId,
    normalized.entityType,
    normalized.actionType,
    normalized.searchText,
  ] as const;
}

export function archiveFilterOptionsQueryKey(profileId: string | undefined) {
  return ["archive", "filter-options", profileId] as const;
}

export function getNextArchivePageParam(
  lastPage: readonly ArchiveAuditLogItem[],
): ArchiveCursor | undefined {
  if (lastPage.length !== ARCHIVE_PAGE_SIZE) return undefined;
  const lastRow = lastPage[lastPage.length - 1];
  return lastRow
    ? { createdAt: lastRow.createdAt, auditLogId: lastRow.auditLogId }
    : undefined;
}

export function useArchiveAuditLog(filters: ArchiveFilters) {
  const { profile } = useAuth();
  const normalized = normalizeArchiveFilters(filters);

  return useInfiniteQuery({
    queryKey: archiveQueryKey(profile?.id, normalized),
    queryFn: async ({ pageParam }) => {
      const result = await listAuditLogPage(normalized, pageParam);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    initialPageParam: null as ArchiveCursor | null,
    getNextPageParam: getNextArchivePageParam,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
    gcTime: 0,
  });
}

export function useArchiveFilterOptions() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: archiveFilterOptionsQueryKey(profile?.id),
    queryFn: getAuditLogFilterOptions,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
