import { supabase } from "../../../lib/supabase/client";

export type WorkOrderStatus = "draft" | "finished";

export interface WorkOrderListItem {
  id: string;
  workOrderNumber: string;
  status: WorkOrderStatus;
  projectId: string | null;
  projectName: string | null;
  customerName: string | null;
  createdAt: string;
}

export interface WorkOrderListError {
  code: "work_order_list_failed";
  message: string;
}

export type WorkOrderListResult =
  | { ok: true; value: WorkOrderListItem[] }
  | { ok: false; error: WorkOrderListError };

const allowedKeys = new Set([
  "work_order_id",
  "work_order_number",
  "status",
  "project_id",
  "project_name",
  "customer_name_snapshot",
  "created_at",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workOrderNumberPattern = /^RN-[0-9]{4}-[0-9]{4}$/;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isNullableTrimmedNonblank(value: unknown): value is string | null {
  return value === null || isTrimmedNonblank(value);
}

function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return value === "draft" || value === "finished";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value));
}

function parseWorkOrderRow(value: unknown): WorkOrderListItem | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== allowedKeys.size ||
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    !isUuid(value.work_order_id) ||
    typeof value.work_order_number !== "string" ||
    !workOrderNumberPattern.test(value.work_order_number) ||
    !isWorkOrderStatus(value.status) ||
    !(
      (value.project_id === null && value.project_name === null) ||
      (isUuid(value.project_id) && isTrimmedNonblank(value.project_name))
    ) ||
    !isNullableTrimmedNonblank(value.customer_name_snapshot) ||
    !isTimestamp(value.created_at)
  ) {
    return null;
  }

  return {
    id: value.work_order_id,
    workOrderNumber: value.work_order_number,
    status: value.status,
    projectId: value.project_id,
    projectName: value.project_name,
    customerName: value.customer_name_snapshot,
    createdAt: value.created_at,
  };
}

function listFailure(): WorkOrderListResult {
  return {
    ok: false,
    error: {
      code: "work_order_list_failed",
      message: "The Work Order list could not be loaded.",
    },
  };
}

export async function listWorkOrders(): Promise<WorkOrderListResult> {
  try {
    const { data, error } = await supabase.rpc("list_work_orders");

    if (error || !Array.isArray(data)) return listFailure();

    const workOrders: WorkOrderListItem[] = [];
    for (const row of data) {
      const workOrder = parseWorkOrderRow(row);
      if (!workOrder) return listFailure();
      workOrders.push(workOrder);
    }

    return { ok: true, value: workOrders };
  } catch {
    return listFailure();
  }
}
