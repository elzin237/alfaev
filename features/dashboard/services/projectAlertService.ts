import { supabase } from "../../../lib/supabase/client";

export const PROJECT_ALERT_PAGE_SIZE = 20;

export interface ProjectAlertCursor {
  createdAt: string;
  notificationId: string;
}

export interface ProjectAlertNotification {
  notificationId: string;
  alertId: string;
  notificationKind: "activity" | "issue_resolved" | "shortage";
  projectId: string;
  projectName: string;
  activityId: string | null;
  activityTitle: string | null;
  activityAuthorFullName: string | null;
  resolutionId: string | null;
  resolverFullName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface ProjectAlertPage {
  items: ProjectAlertNotification[];
  hasMore: boolean;
}

export interface ProjectAlertUnreadCount {
  exactValue: bigint | null;
  displayValue: string;
  hasUnread: boolean;
}

export interface ProjectAlertReadReceipt {
  notificationId: string;
  readAt: string;
}

export interface ProjectAlertDismissReceipt {
  notificationId: string;
  dismissedAt: string;
}

export type ProjectAlertErrorCode =
  | "access_denied"
  | "invalid_request"
  | "notification_unavailable"
  | "inbox_load_failed"
  | "unread_count_load_failed"
  | "mark_read_failed"
  | "dismiss_failed"
  | "request_pending";

export interface ProjectAlertError {
  code: ProjectAlertErrorCode;
  message: string;
}

export type ProjectAlertResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: ProjectAlertError };

interface RpcErrorLike {
  code?: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const unsignedIntegerPattern = /^(?:0|[1-9]\d*)$/;
const inboxRowKeys = [
  "notification_id",
  "event_id",
  "notification_kind",
  "project_id",
  "project_name",
  "activity_id",
  "activity_title",
  "activity_author_full_name",
  "resolution_id",
  "resolver_full_name",
  "resolved_at",
  "created_at",
  "read_at",
  "has_more",
] as const;
const markReadRowKeys = ["notification_id", "read_at"] as const;
const dismissRowKeys = ["notification_id", "dismissed_at"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function safeError(
  code: ProjectAlertErrorCode,
  message: string,
): ProjectAlertError {
  return { code, message };
}

function mapRpcError(
  error: RpcErrorLike | null,
  fallback:
    | "inbox_load_failed"
    | "unread_count_load_failed"
    | "mark_read_failed"
    | "dismiss_failed",
): ProjectAlertError {
  switch (error?.code) {
    case "42501":
      return safeError(
        "access_denied",
        "You no longer have access to Project alerts.",
      );
    case "22023":
      return safeError("invalid_request", "The alert request is invalid.");
    case "P0002":
      return safeError(
        "notification_unavailable",
        "This notification is no longer available.",
      );
    default:
      if (fallback === "inbox_load_failed") {
        return safeError(
          fallback,
          "Project alerts could not be loaded. Please try again.",
        );
      }
      if (fallback === "unread_count_load_failed") {
        return safeError(
          fallback,
          "The unread alert count could not be loaded. Please try again.",
        );
      }
      if (fallback === "dismiss_failed") {
        return safeError(
          fallback,
          "The notification could not be dismissed. Please try again.",
        );
      }
      return safeError(
        fallback,
        "The notification could not be marked as read. Please try again.",
      );
  }
}

function parseInboxRow(value: unknown): ProjectAlertNotification | null {
  if (!isRecord(value) || !hasExactKeys(value, inboxRowKeys) ||
    !isUuid(value.notification_id) || !isUuid(value.event_id) ||
    !(value.notification_kind === "activity" ||
      value.notification_kind === "issue_resolved" ||
      value.notification_kind === "shortage") ||
    !isUuid(value.project_id) || !isTrimmedNonblank(value.project_name) ||
    !isTimestamp(value.created_at) ||
    !(value.read_at === null || isTimestamp(value.read_at)) ||
    typeof value.has_more !== "boolean") {
    return null;
  }

  const activityFieldsValid = isUuid(value.activity_id) &&
    isTrimmedNonblank(value.activity_title) &&
    isTrimmedNonblank(value.activity_author_full_name);
  const activityFieldsNull = value.activity_id === null &&
    value.activity_title === null && value.activity_author_full_name === null;
  const resolutionFieldsValid = isUuid(value.resolution_id) &&
    isTrimmedNonblank(value.resolver_full_name) && isTimestamp(value.resolved_at);
  const resolutionFieldsNull = value.resolution_id === null &&
    value.resolver_full_name === null && value.resolved_at === null;
  if (
    (value.notification_kind === "activity" &&
      (!activityFieldsValid || !resolutionFieldsNull)) ||
    (value.notification_kind === "issue_resolved" &&
      (!activityFieldsValid || !resolutionFieldsValid)) ||
    (value.notification_kind === "shortage" &&
      (!activityFieldsNull || !resolutionFieldsNull))
  ) return null;

  return {
    notificationId: value.notification_id,
    alertId: value.event_id,
    notificationKind: value.notification_kind,
    projectId: value.project_id,
    projectName: value.project_name,
    activityId: value.activity_id as string | null,
    activityTitle: value.activity_title as string | null,
    activityAuthorFullName: value.activity_author_full_name as string | null,
    resolutionId: value.resolution_id as string | null,
    resolverFullName: value.resolver_full_name as string | null,
    resolvedAt: value.resolved_at as string | null,
    createdAt: value.created_at,
    readAt: value.read_at,
  };
}

export function parseProjectAlertUnreadCount(
  value: unknown,
): ProjectAlertUnreadCount | null {
  let exactValue: bigint | null = null;

  if (typeof value === "string" && unsignedIntegerPattern.test(value)) {
    exactValue = BigInt(value);
  } else if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    if (Number.isSafeInteger(value)) {
      exactValue = BigInt(value);
    } else if (value > 99) {
      return { exactValue: null, displayValue: "99+", hasUnread: true };
    } else {
      return null;
    }
  } else {
    return null;
  }

  return {
    exactValue,
    displayValue: exactValue > 99n ? "99+" : exactValue.toString(),
    hasUnread: exactValue > 0n,
  };
}

export async function listProjectAlertNotifications(
  cursor: ProjectAlertCursor | null = null,
): Promise<ProjectAlertResult<ProjectAlertPage>> {
  if (cursor && (!isTimestamp(cursor.createdAt) || !isUuid(cursor.notificationId))) {
    return { ok: false, error: mapRpcError({ code: "22023" }, "inbox_load_failed") };
  }

  let response: { data: unknown; error: RpcErrorLike | null };
  try {
    response = await supabase.rpc("list_project_notifications", {
      p_limit: PROJECT_ALERT_PAGE_SIZE,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_recipient_id: cursor?.notificationId ?? null,
    });
  } catch {
    return { ok: false, error: mapRpcError(null, "inbox_load_failed") };
  }

  if (response.error || !Array.isArray(response.data) ||
    response.data.length > PROJECT_ALERT_PAGE_SIZE) {
    return {
      ok: false,
      error: mapRpcError(response.error, "inbox_load_failed"),
    };
  }

  const items: ProjectAlertNotification[] = [];
  const notificationIds = new Set<string>();
  let hasMore = false;
  for (const [index, row] of response.data.entries()) {
    const parsed = parseInboxRow(row);
    if (!parsed || notificationIds.has(parsed.notificationId)) {
      return { ok: false, error: mapRpcError(null, "inbox_load_failed") };
    }
    const rowHasMore = (row as Record<string, unknown>).has_more as boolean;
    if (index === 0) hasMore = rowHasMore;
    if (rowHasMore !== hasMore) {
      return { ok: false, error: mapRpcError(null, "inbox_load_failed") };
    }
    notificationIds.add(parsed.notificationId);
    items.push(parsed);
  }

  return { ok: true, value: { items, hasMore } };
}

export async function getProjectAlertUnreadCount(): Promise<
  ProjectAlertResult<ProjectAlertUnreadCount>
> {
  let response: { data: unknown; error: RpcErrorLike | null };
  try {
    response = await supabase.rpc("get_project_alert_unread_count");
  } catch {
    return { ok: false, error: mapRpcError(null, "unread_count_load_failed") };
  }

  const parsed = response.error ? null : parseProjectAlertUnreadCount(response.data);
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, error: mapRpcError(response.error, "unread_count_load_failed") };
}

export async function markProjectAlertRead(
  notificationId: string,
): Promise<ProjectAlertResult<ProjectAlertReadReceipt>> {
  if (!isUuid(notificationId)) {
    return { ok: false, error: mapRpcError({ code: "22023" }, "mark_read_failed") };
  }

  let response: { data: unknown; error: RpcErrorLike | null };
  try {
    response = await supabase.rpc("mark_project_alert_read", {
      p_notification_id: notificationId,
    });
  } catch {
    return { ok: false, error: mapRpcError(null, "mark_read_failed") };
  }

  if (response.error || !Array.isArray(response.data) || response.data.length !== 1) {
    return { ok: false, error: mapRpcError(response.error, "mark_read_failed") };
  }
  const row = response.data[0];
  if (!isRecord(row) || !hasExactKeys(row, markReadRowKeys) ||
    row.notification_id !== notificationId || !isTimestamp(row.read_at)) {
    return { ok: false, error: mapRpcError(null, "mark_read_failed") };
  }

  return {
    ok: true,
    value: { notificationId, readAt: row.read_at },
  };
}

export async function dismissProjectAlertNotification(
  notificationId: string,
): Promise<ProjectAlertResult<ProjectAlertDismissReceipt>> {
  if (!isUuid(notificationId)) {
    return { ok: false, error: mapRpcError({ code: "22023" }, "dismiss_failed") };
  }

  let response: { data: unknown; error: RpcErrorLike | null };
  try {
    response = await supabase.rpc("dismiss_project_alert_notification", {
      p_notification_id: notificationId,
    });
  } catch {
    return { ok: false, error: mapRpcError(null, "dismiss_failed") };
  }

  if (response.error || !Array.isArray(response.data) || response.data.length !== 1) {
    return { ok: false, error: mapRpcError(response.error, "dismiss_failed") };
  }
  const row = response.data[0];
  if (!isRecord(row) || !hasExactKeys(row, dismissRowKeys) ||
    row.notification_id !== notificationId || !isTimestamp(row.dismissed_at)) {
    return { ok: false, error: mapRpcError(null, "dismiss_failed") };
  }

  return {
    ok: true,
    value: { notificationId, dismissedAt: row.dismissed_at },
  };
}
