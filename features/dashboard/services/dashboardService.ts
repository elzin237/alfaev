import { supabase } from "../../../lib/supabase/client";
import {
  isProjectStatus,
  type ProjectStatus,
} from "../../projects/projectStatus";

export interface DashboardProjectStatusCounts {
  planned: number;
  inProgress: number;
  onHold: number;
  completed: number;
  cancelled: number;
}

export interface DashboardProject {
  id: string;
  name: string;
  customerName: string;
  status: ProjectStatus;
  deliveryDate: string;
  updatedAt: string;
}

export interface DashboardProjectsSection {
  statusCounts: DashboardProjectStatusCounts;
  recent: DashboardProject[];
}

export type DashboardWorkOrderStatus = "draft" | "finished";

export interface DashboardWorkOrder {
  id: string;
  workOrderNumber: string;
  status: DashboardWorkOrderStatus;
  projectId: string | null;
  customerNameSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface DashboardWorkOrdersSection {
  recent: DashboardWorkOrder[];
}

export interface DashboardProcurementRequest {
  id: string;
  requestedName: string;
  status: "active" | "partly_delivered";
  requestedQuantity: string;
  deliveredQuantity: string;
  remainingQuantity: string;
  productSerialNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardProcurementSection {
  unresolvedCount: number;
  unresolved: DashboardProcurementRequest[];
}

export interface DashboardInventoryProduct {
  productId: string;
  serialNumber: string;
  name: string;
  category: string;
  quantity: string;
  updatedAt: string;
}

export interface DashboardInventorySection {
  activeProductCount: number;
  recent: DashboardInventoryProduct[];
}

export interface DashboardActivity {
  auditLogId: string;
  actorUserId: string;
  actorFullName: string;
  actionType: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

export interface DashboardActivitySection {
  recent: DashboardActivity[];
}

export type DashboardCalendarKind =
  | "business_trip"
  | "event"
  | "vacation"
  | "birthday";

export interface DashboardCalendarEntry {
  kind: DashboardCalendarKind;
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  relatedUserId: string | null;
}

export interface DashboardCalendarSection {
  upcoming: DashboardCalendarEntry[];
}

export interface DashboardReadModel {
  projects: DashboardProjectsSection | null;
  workOrders: DashboardWorkOrdersSection | null;
  procurement: DashboardProcurementSection | null;
  inventory: DashboardInventorySection | null;
  activity: DashboardActivitySection | null;
  calendar: DashboardCalendarSection;
}

export type DashboardServiceResult =
  | { ok: true; value: DashboardReadModel }
  | {
    ok: false;
    error: { code: "dashboard_load_failed"; message: string };
  };

const safeError: DashboardServiceResult = {
  ok: false,
  error: {
    code: "dashboard_load_failed",
    message: "The Dashboard overview could not be loaded.",
  },
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const unsignedIntegerPattern = /^(?:0|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => key in value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isSqlDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = datePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function isNonnegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isUnsignedIntegerText(value: unknown): value is string {
  return typeof value === "string" && unsignedIntegerPattern.test(value);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isNullableTrimmedNonblank(value: unknown): value is string | null {
  return value === null || isTrimmedNonblank(value);
}

function parseProjects(value: unknown): DashboardProjectsSection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["status_counts", "recent"])) {
    return undefined;
  }
  const counts = value.status_counts;
  if (!isRecord(counts) || !hasExactKeys(counts, [
    "planned", "in_progress", "on_hold", "completed", "cancelled",
  ]) || !isNonnegativeCount(counts.planned) ||
    !isNonnegativeCount(counts.in_progress) ||
    !isNonnegativeCount(counts.on_hold) ||
    !isNonnegativeCount(counts.completed) ||
    !isNonnegativeCount(counts.cancelled) || !Array.isArray(value.recent)) {
    return undefined;
  }
  const recent: DashboardProject[] = [];
  for (const item of value.recent) {
    if (!isRecord(item) || !hasExactKeys(item, [
      "id", "name", "customer_name", "status", "delivery_date", "updated_at",
    ]) || !isUuid(item.id) || !isTrimmedNonblank(item.name) ||
      !isTrimmedNonblank(item.customer_name) || !isProjectStatus(item.status) ||
      !isSqlDate(item.delivery_date) || !isTimestamp(item.updated_at)) {
      return undefined;
    }
    recent.push({
      id: item.id,
      name: item.name,
      customerName: item.customer_name,
      status: item.status,
      deliveryDate: item.delivery_date,
      updatedAt: item.updated_at,
    });
  }
  return {
    statusCounts: {
      planned: counts.planned,
      inProgress: counts.in_progress,
      onHold: counts.on_hold,
      completed: counts.completed,
      cancelled: counts.cancelled,
    },
    recent,
  };
}

function parseWorkOrders(
  value: unknown,
): DashboardWorkOrdersSection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["recent"]) ||
    !Array.isArray(value.recent)) return undefined;
  const recent: DashboardWorkOrder[] = [];
  for (const item of value.recent) {
    if (!isRecord(item) || !hasExactKeys(item, [
      "id", "work_order_number", "status", "project_id",
      "customer_name_snapshot", "created_at", "updated_at", "finished_at",
    ]) || !isUuid(item.id) ||
      typeof item.work_order_number !== "string" ||
      !/^RN-\d{4}-\d{4}$/.test(item.work_order_number) ||
      (item.status !== "draft" && item.status !== "finished") ||
      !isNullableUuid(item.project_id) ||
      !isNullableTrimmedNonblank(item.customer_name_snapshot) ||
      !isTimestamp(item.created_at) || !isTimestamp(item.updated_at) ||
      (item.finished_at !== null && !isTimestamp(item.finished_at))) {
      return undefined;
    }
    if (item.status === "draft" && item.finished_at !== null) return undefined;
    if (item.status === "finished" && item.finished_at === null) return undefined;
    recent.push({
      id: item.id,
      workOrderNumber: item.work_order_number,
      status: item.status,
      projectId: item.project_id,
      customerNameSnapshot: item.customer_name_snapshot,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      finishedAt: item.finished_at,
    });
  }
  return { recent };
}

function parseProcurement(
  value: unknown,
): DashboardProcurementSection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["unresolved_count", "unresolved"]) ||
    !isNonnegativeCount(value.unresolved_count) || !Array.isArray(value.unresolved)) {
    return undefined;
  }
  const unresolved: DashboardProcurementRequest[] = [];
  for (const item of value.unresolved) {
    if (!isRecord(item) || !hasExactKeys(item, [
      "id", "requested_name", "status", "requested_quantity",
      "delivered_quantity", "remaining_quantity", "product_serial_number",
      "created_at", "updated_at",
    ]) || !isUuid(item.id) || !isTrimmedNonblank(item.requested_name) ||
      (item.status !== "active" && item.status !== "partly_delivered") ||
      !isUnsignedIntegerText(item.requested_quantity) ||
      item.requested_quantity === "0" ||
      !isUnsignedIntegerText(item.delivered_quantity) ||
      !isUnsignedIntegerText(item.remaining_quantity) ||
      (item.product_serial_number !== null && (
        typeof item.product_serial_number !== "string" ||
        !/^\d{7}$/.test(item.product_serial_number)
      )) || !isTimestamp(item.created_at) || !isTimestamp(item.updated_at)) {
      return undefined;
    }
    try {
      if (BigInt(item.delivered_quantity) + BigInt(item.remaining_quantity) !==
        BigInt(item.requested_quantity)) return undefined;
    } catch {
      return undefined;
    }
    unresolved.push({
      id: item.id,
      requestedName: item.requested_name,
      status: item.status,
      requestedQuantity: item.requested_quantity,
      deliveredQuantity: item.delivered_quantity,
      remainingQuantity: item.remaining_quantity,
      productSerialNumber: item.product_serial_number,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    });
  }
  return { unresolvedCount: value.unresolved_count, unresolved };
}

function parseInventory(
  value: unknown,
): DashboardInventorySection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["active_product_count", "recent"]) ||
    !isNonnegativeCount(value.active_product_count) || !Array.isArray(value.recent)) {
    return undefined;
  }
  const recent: DashboardInventoryProduct[] = [];
  for (const item of value.recent) {
    if (!isRecord(item) || !hasExactKeys(item, [
      "product_id", "serial_number", "name", "category", "quantity", "updated_at",
    ]) || !isUuid(item.product_id) || typeof item.serial_number !== "string" ||
      !/^\d{7}$/.test(item.serial_number) || !isTrimmedNonblank(item.name) ||
      !isTrimmedNonblank(item.category) || !isUnsignedIntegerText(item.quantity) ||
      !isTimestamp(item.updated_at)) return undefined;
    recent.push({
      productId: item.product_id,
      serialNumber: item.serial_number,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      updatedAt: item.updated_at,
    });
  }
  return { activeProductCount: value.active_product_count, recent };
}

function parseActivity(
  value: unknown,
): DashboardActivitySection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["recent"]) ||
    !Array.isArray(value.recent)) return undefined;
  const recent: DashboardActivity[] = [];
  for (const item of value.recent) {
    if (!isRecord(item) || !hasExactKeys(item, [
      "audit_log_id", "actor_user_id", "actor_full_name", "action_type",
      "entity_type", "entity_id", "summary", "created_at",
    ]) || !isUuid(item.audit_log_id) || !isUuid(item.actor_user_id) ||
      !isTrimmedNonblank(item.actor_full_name) ||
      !isTrimmedNonblank(item.action_type) || !isTrimmedNonblank(item.entity_type) ||
      !isNullableUuid(item.entity_id) || !isTrimmedNonblank(item.summary) ||
      !isTimestamp(item.created_at)) return undefined;
    recent.push({
      auditLogId: item.audit_log_id,
      actorUserId: item.actor_user_id,
      actorFullName: item.actor_full_name,
      actionType: item.action_type,
      entityType: item.entity_type,
      entityId: item.entity_id,
      summary: item.summary,
      createdAt: item.created_at,
    });
  }
  return { recent };
}

function parseCalendar(value: unknown): DashboardCalendarSection | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["upcoming"]) ||
    !Array.isArray(value.upcoming)) return undefined;
  const upcoming: DashboardCalendarEntry[] = [];
  const kinds: readonly string[] = ["business_trip", "event", "vacation", "birthday"];
  for (const item of value.upcoming) {
    if (!isRecord(item) || !hasExactKeys(item, [
      "kind", "id", "title", "start_date", "end_date", "related_user_id",
    ]) || typeof item.kind !== "string" || !kinds.includes(item.kind) ||
      !isUuid(item.id) || !isTrimmedNonblank(item.title) ||
      !isSqlDate(item.start_date) || !isSqlDate(item.end_date) ||
      item.end_date < item.start_date || !isNullableUuid(item.related_user_id)) {
      return undefined;
    }
    upcoming.push({
      kind: item.kind as DashboardCalendarKind,
      id: item.id,
      title: item.title,
      startDate: item.start_date,
      endDate: item.end_date,
      relatedUserId: item.related_user_id,
    });
  }
  return { upcoming };
}

function parseDashboardReadModel(value: unknown): DashboardReadModel | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "projects", "work_orders", "procurement", "inventory", "activity", "calendar",
  ])) return null;

  const projects = parseProjects(value.projects);
  const workOrders = parseWorkOrders(value.work_orders);
  const procurement = parseProcurement(value.procurement);
  const inventory = parseInventory(value.inventory);
  const activity = parseActivity(value.activity);
  const calendar = parseCalendar(value.calendar);
  if (projects === undefined || workOrders === undefined || procurement === undefined ||
    inventory === undefined || activity === undefined || calendar === undefined) return null;
  return { projects, workOrders, procurement, inventory, activity, calendar };
}

export async function getDashboardReadModel(): Promise<DashboardServiceResult> {
  try {
    const { data, error } = await supabase.rpc("get_dashboard_read_model");
    if (error) return safeError;
    const parsed = parseDashboardReadModel(data);
    return parsed ? { ok: true, value: parsed } : safeError;
  } catch {
    return safeError;
  }
}
