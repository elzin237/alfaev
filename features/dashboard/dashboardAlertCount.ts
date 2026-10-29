import type { ProjectAlertUnreadCount } from "./services/projectAlertService";

interface AlertCountQuery {
  data?: ProjectAlertUnreadCount;
  isPending?: boolean;
  isFetching?: boolean;
  isError: boolean;
}

/** Shared presentation of the existing recipient/permission-scoped count query. */
export function getDashboardAlertCount(
  query: AlertCountQuery,
  tracking: boolean,
  canRead: boolean,
) {
  const isLoading = Boolean(query.isPending || query.isFetching);
  const ready = canRead && !isLoading && !query.isError && query.data !== undefined;
  const activeShortages = query.data?.exactValue;
  const projectUnread = query.data?.projectUnread;
  const verifiedCounts = ready && activeShortages != null && projectUnread !== undefined
    ? { activeShortages, projectUnread }
    : null;
  // Count unique active episodes from the server, never paginated inbox rows.
  const combinedCount = verifiedCounts
    ? verifiedCounts.activeShortages + verifiedCounts.projectUnread
    : null;
  const badgeValue = tracking
    ? combinedCount !== null && combinedCount > 0n
      ? combinedCount > 99n ? "99+" : combinedCount.toString()
      : null
    : ready && query.data?.hasUnread ? query.data.displayValue : null;

  return { isLoading, verifiedCounts, combinedCount, badgeValue };
}
