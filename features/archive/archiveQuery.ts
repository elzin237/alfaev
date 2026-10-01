import { useInfiniteQuery } from "@tanstack/react-query";

import { useAuth } from "../../app/auth/AuthProvider";
import {
  ARCHIVE_PAGE_SIZE,
  listAuditLogPage,
  type ArchiveAuditLogItem,
  type ArchiveCursor,
} from "./archiveService";

export function archiveQueryKey(profileId: string | undefined) {
  return ["archive", "audit-log", profileId] as const;
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

export function useArchiveAuditLog() {
  const { profile } = useAuth();

  return useInfiniteQuery({
    queryKey: archiveQueryKey(profile?.id),
    queryFn: async ({ pageParam }) => {
      const result = await listAuditLogPage(pageParam);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    initialPageParam: null as ArchiveCursor | null,
    getNextPageParam: getNextArchivePageParam,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
