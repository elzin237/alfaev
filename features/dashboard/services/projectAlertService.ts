import { supabase } from "../../../lib/supabase/client";
import { isWorkOrderNotificationsEnabled } from "../../../app/config/workOrderNotificationsActivation";
import { isWorkOrderActiveShortagesEnabled } from "../../../app/config/workOrderActiveShortagesActivation";

export const PROJECT_ALERT_PAGE_SIZE = 20;

export interface ProjectAlertCursor {
  createdAt: string;
  notificationId: string;
}

interface ProjectAlertNotificationBase {
  targetType?: "project";
  notificationId: string;
  alertId: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  readAt: string | null;
}

export interface ProjectActivityAlertNotification
  extends ProjectAlertNotificationBase {
  notificationKind: "activity";
  activityId: string;
  activityTitle: string;
  activityAuthorFullName: string;
  resolutionId: null;
  resolverFullName: null;
  resolvedAt: null;
  productId: null;
  productSerialNumber: null;
  productName: null;
  shortageEventType: null;
  shortageQuantity: null;
  isBaselineDetection: null;
}

export interface ProjectIssueResolvedAlertNotification
  extends ProjectAlertNotificationBase {
  notificationKind: "issue_resolved";
  activityId: string;
  activityTitle: string;
  activityAuthorFullName: string;
  resolutionId: string;
  resolverFullName: string;
  resolvedAt: string;
  productId: null;
  productSerialNumber: null;
  productName: null;
  shortageEventType: null;
  shortageQuantity: null;
  isBaselineDetection: null;
}

export interface ProjectShortageAlertNotification
  extends ProjectAlertNotificationBase {
  notificationKind: "shortage";
  activityId: null;
  activityTitle: null;
  activityAuthorFullName: null;
  resolutionId: null;
  resolverFullName: null;
  resolvedAt: null;
  productId: string;
  productSerialNumber: string;
  productName: string;
  shortageEventType: "opened" | "resolved";
  shortageQuantity: string;
  isBaselineDetection: boolean;
}

export type ProjectAlertNotification =
  | ProjectActivityAlertNotification
  | ProjectIssueResolvedAlertNotification
  | ProjectShortageAlertNotification
  | WorkOrderShortageAlertNotification;

export interface WorkOrderShortageAlertNotification {
  episodeStatus?: "active" | "resolved";
  episodeId?: string;
  targetType: "work_order";
  notificationKind: "work_order_shortage";
  notificationId: string;
  alertId: string;
  projectId: null;
  projectName: null;
  workOrderId: string;
  workOrderNumber: string;
  productId: string;
  productName: string;
  shortageEventType: "opened" | "resolved";
  shortageQuantity: string;
  createdAt: string;
  readAt: string | null;
  activityId: null;
  activityTitle: null;
}

export function dashboardAlertDestination(item: ProjectAlertNotification): string {
  if (item.targetType === "work_order") return `/work-orders/${item.workOrderId}`;
  return item.activityId ? `/projects/${item.projectId}#activity-${item.activityId}` : `/projects/${item.projectId}`;
}

export function dashboardAlertLabel(item: ProjectAlertNotification): string {
  return item.targetType === "work_order" ? item.workOrderNumber : item.projectName;
}

export interface ProjectAlertPage {
  items: ProjectAlertNotification[];
  hasMore: boolean;
}

export interface ProjectAlertUnreadCount {
  projectUnread?: bigint;
  asOf?: string;
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
const unsignedDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const zeroDecimalPattern = /^0(?:\.0+)?$/;
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
  "product_id",
  "product_serial_number",
  "product_name",
  "shortage_event_type",
  "shortage_quantity",
  "is_baseline_detection",
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
  if (isRecord(value) && value.target_type === "work_order") {
    const tracking=isWorkOrderActiveShortagesEnabled();
    if (!hasExactKeys(value,["target_type","notification_id","event_id","notification_kind","work_order_id",
      "work_order_number","product_id","product_name","shortage_event_type","shortage_quantity","created_at","read_at","has_more",...(tracking?["episode_id","episode_status"]:[])]) ||
      (tracking && (!isUuid(value.episode_id) || !["active","resolved"].includes(value.episode_status as string) ||
        (value.episode_status === "active") !== (value.shortage_event_type === "opened") ||
        (value.episode_status === "resolved" && value.read_at === null))) ||
      value.notification_kind !== "work_order_shortage" || !isUuid(value.notification_id) || !isUuid(value.event_id) ||
      !isUuid(value.work_order_id) || !isUuid(value.product_id) || !isTrimmedNonblank(value.work_order_number) ||
      !isTrimmedNonblank(value.product_name) || !isTimestamp(value.created_at) ||
      !(value.read_at === null || isTimestamp(value.read_at)) || typeof value.has_more !== "boolean" ||
      typeof value.shortage_quantity !== "string" || !unsignedIntegerPattern.test(value.shortage_quantity) ||
      BigInt(value.shortage_quantity)>9223372036854775807n ||
      !((value.shortage_event_type === "opened" && BigInt(value.shortage_quantity)>0n) ||
        (value.shortage_event_type === "resolved" && value.shortage_quantity === "0"))) return null;
    return {...(tracking?{episodeId:value.episode_id as string,episodeStatus:value.episode_status as "active"|"resolved"}:{}),targetType:"work_order",notificationKind:"work_order_shortage",notificationId:value.notification_id,
      alertId:value.event_id,projectId:null,projectName:null,workOrderId:value.work_order_id,
      workOrderNumber:value.work_order_number,productId:value.product_id,productName:value.product_name,
      shortageEventType:value.shortage_event_type as "opened"|"resolved",shortageQuantity:value.shortage_quantity,
      createdAt:value.created_at,readAt:value.read_at,activityId:null,activityTitle:null};
  }
  if (isRecord(value) && value.target_type === "project") {
    const {target_type: _targetType,...project}=value;
    const parsed=parseInboxRow(project);
    return parsed && parsed.targetType !== "work_order" ? {...parsed,targetType:"project"} : null;
  }
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
  const shortageFieldsNull = value.product_id === null &&
    value.product_serial_number === null && value.product_name === null &&
    value.shortage_event_type === null && value.shortage_quantity === null &&
    value.is_baseline_detection === null;
  const shortageIdentityValid = isUuid(value.product_id) &&
    isTrimmedNonblank(value.product_serial_number) &&
    isTrimmedNonblank(value.product_name);
  const shortageEventValid =
    (value.shortage_event_type === "opened" ||
      value.shortage_event_type === "resolved") &&
    typeof value.shortage_quantity === "string" &&
    unsignedDecimalPattern.test(value.shortage_quantity) &&
    typeof value.is_baseline_detection === "boolean" &&
    (
      (value.shortage_event_type === "opened" &&
        !zeroDecimalPattern.test(value.shortage_quantity)) ||
      (value.shortage_event_type === "resolved" &&
        zeroDecimalPattern.test(value.shortage_quantity) &&
        !value.is_baseline_detection)
    );
  const common = {
    notificationId: value.notification_id,
    alertId: value.event_id,
    projectId: value.project_id,
    projectName: value.project_name,
    createdAt: value.created_at,
    readAt: value.read_at,
  };

  if (value.notification_kind === "activity") {
    if (!activityFieldsValid || !resolutionFieldsNull || !shortageFieldsNull) return null;
    return {
      ...common,
      notificationKind: "activity",
      activityId: value.activity_id as string,
      activityTitle: value.activity_title as string,
      activityAuthorFullName: value.activity_author_full_name as string,
      resolutionId: null,
      resolverFullName: null,
      resolvedAt: null,
      productId: null,
      productSerialNumber: null,
      productName: null,
      shortageEventType: null,
      shortageQuantity: null,
      isBaselineDetection: null,
    };
  }

  if (value.notification_kind === "issue_resolved") {
    if (!activityFieldsValid || !resolutionFieldsValid || !shortageFieldsNull) return null;
    return {
      ...common,
      notificationKind: "issue_resolved",
      activityId: value.activity_id as string,
      activityTitle: value.activity_title as string,
      activityAuthorFullName: value.activity_author_full_name as string,
      resolutionId: value.resolution_id as string,
      resolverFullName: value.resolver_full_name as string,
      resolvedAt: value.resolved_at as string,
      productId: null,
      productSerialNumber: null,
      productName: null,
      shortageEventType: null,
      shortageQuantity: null,
      isBaselineDetection: null,
    };
  }

  if (!activityFieldsNull || !resolutionFieldsNull ||
    !shortageIdentityValid || !shortageEventValid) return null;
  return {
    ...common,
    notificationKind: "shortage",
    activityId: null,
    activityTitle: null,
    activityAuthorFullName: null,
    resolutionId: null,
    resolverFullName: null,
    resolvedAt: null,
    productId: value.product_id as string,
    productSerialNumber: value.product_serial_number as string,
    productName: value.product_name as string,
    shortageEventType: value.shortage_event_type as "opened" | "resolved",
    shortageQuantity: value.shortage_quantity as string,
    isBaselineDetection: value.is_baseline_detection as boolean,
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
    response = await supabase.rpc(isWorkOrderActiveShortagesEnabled() ? "list_dashboard_shortage_tracking" : isWorkOrderNotificationsEnabled() ? "list_dashboard_notifications" : "list_project_notifications", {
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
    response = await supabase.rpc(isWorkOrderActiveShortagesEnabled() ? "get_dashboard_alert_counts" : isWorkOrderNotificationsEnabled() ? "get_dashboard_notification_unread_count" : "get_project_alert_unread_count");
  } catch {
    return { ok: false, error: mapRpcError(null, "unread_count_load_failed") };
  }

  if(isWorkOrderActiveShortagesEnabled()) {
    const data=response.data;
    if(response.error || !isRecord(data) || !hasExactKeys(data,["active_work_order_shortages","unread_project_notifications","as_of"]) ||
      typeof data.active_work_order_shortages!=="string" || !unsignedIntegerPattern.test(data.active_work_order_shortages) ||
      typeof data.unread_project_notifications!=="string" || !unsignedIntegerPattern.test(data.unread_project_notifications) || !isTimestamp(data.as_of))
      return {ok:false,error:mapRpcError(null,"unread_count_load_failed")};
    const parsed=parseProjectAlertUnreadCount(data.active_work_order_shortages);
    return parsed ? {ok:true,value:{...parsed,projectUnread:BigInt(data.unread_project_notifications),asOf:data.as_of}}
      : {ok:false,error:mapRpcError(null,"unread_count_load_failed")};
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
    response = await supabase.rpc(isWorkOrderNotificationsEnabled() ? "mark_dashboard_notification_read" : "mark_project_alert_read", {
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
    response = await supabase.rpc(isWorkOrderNotificationsEnabled() ? "dismiss_dashboard_notification" : "dismiss_project_alert_notification", {
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
