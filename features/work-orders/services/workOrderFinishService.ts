import { supabase } from "../../../lib/supabase/client";
import { isWorkOrderId, isWorkOrderNumber } from "./workOrderService";

export interface FinishWorkOrderInput {
  workOrderId: string;
  expectedUpdatedAt: string;
  actualGoodQuantity?: string;
}

export interface FinishedWorkOrder {
  workOrderId: string;
  workOrderNumber: string;
  finishedAt: string;
  projectId: string | null;
  projectCompleted: boolean;
  workOrderPdfId: string;
  storageReference: string;
}

export interface FinishWorkOrderError {
  code:
    | "access_denied"
    | "finish_outcome_unknown"
    | "finish_response_invalid"
    | "finish_failed"
    | "insufficient_inventory"
    | "inventory_balance_unavailable"
    | "invalid_actual_good_quantity"
    | "invalid_request"
    | "pdf_finalization_failed"
    | "product_unavailable"
    | "project_unavailable"
    | "stale_work_order"
    | "work_order_already_finished"
    | "work_order_incomplete"
    | "work_order_not_found";
  message: string;
}

export type FinishWorkOrderResult =
  | { ok: true; value: FinishedWorkOrder }
  | { ok: false; error: FinishWorkOrderError };

const successKeys = new Set([
  "workOrderId",
  "workOrderNumber",
  "finishedAt",
  "projectId",
  "projectCompleted",
  "workOrderPdfId",
  "storageReference",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value));
}

function parseSuccess(
  value: unknown,
  expectedWorkOrderId: string,
): FinishedWorkOrder | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== successKeys.size ||
    Object.keys(value).some((key) => !successKeys.has(key)) ||
    !isWorkOrderId(value.workOrderId) ||
    value.workOrderId !== expectedWorkOrderId ||
    !isWorkOrderNumber(value.workOrderNumber) ||
    !isTimestamp(value.finishedAt) ||
    !(value.projectId === null || (typeof value.projectId === "string" && uuidPattern.test(value.projectId))) ||
    typeof value.projectCompleted !== "boolean" ||
    typeof value.workOrderPdfId !== "string" ||
    !uuidPattern.test(value.workOrderPdfId) ||
    typeof value.storageReference !== "string" ||
    !new RegExp(
      `^final/${expectedWorkOrderId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.pdf$`,
      "i",
    ).test(value.storageReference)
  ) {
    return null;
  }

  return {
    workOrderId: value.workOrderId,
    workOrderNumber: value.workOrderNumber,
    finishedAt: value.finishedAt,
    projectId: value.projectId as string | null,
    projectCompleted: value.projectCompleted,
    workOrderPdfId: value.workOrderPdfId,
    storageReference: value.storageReference,
  };
}

async function readErrorCode(error: unknown): Promise<string | null> {
  if (!isRecord(error) || !(error.context instanceof Response)) return null;

  try {
    const body: unknown = await error.context.json();
    return isRecord(body) && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

function failure(
  code: FinishWorkOrderError["code"],
  message: string,
): FinishWorkOrderResult {
  return { ok: false, error: { code, message } };
}

function mapError(code: string | null): FinishWorkOrderResult {
  switch (code) {
    case "unauthenticated":
    case "access_denied":
      return failure(
        "access_denied",
        "You no longer have permission to finish this Work Order.",
      );
    case "stale_work_order":
      return failure(
        "stale_work_order",
        "This Draft changed since you loaded it. Reload the latest Draft before finishing.",
      );
    case "work_order_already_finished":
      return failure(
        "work_order_already_finished",
        "This Work Order is already Finished. Its latest state is being loaded.",
      );
    case "insufficient_inventory":
      return failure(
        "insufficient_inventory",
        "Current physical Inventory is insufficient to finish this Work Order.",
      );
    case "project_unavailable":
      return failure(
        "project_unavailable",
        "The selected Project is no longer available for this Work Order.",
      );
    case "product_unavailable":
      return failure(
        "product_unavailable",
        "A Work Order material Product is archived or unavailable.",
      );
    case "inventory_balance_unavailable":
      return failure(
        "inventory_balance_unavailable",
        "Current Inventory is unavailable for a Work Order material.",
      );
    case "work_order_incomplete":
      return failure(
        "work_order_incomplete",
        "Complete the Work Order before finishing it.",
      );
    case "work_order_not_found":
      return failure(
        "work_order_not_found",
        "The Work Order could not be found.",
      );
    case "invalid_request":
      return failure(
        "invalid_request",
        "The Work Order finish request is invalid.",
      );
    case "invalid_actual_good_quantity":
      return failure(
        "invalid_actual_good_quantity",
        "Enter an actual completed quantity from 0 through the planned quantity.",
      );
    case "pdf_generation_failed":
    case "storage_preparation_failed":
    case "pdf_candidate_invalid":
      return failure(
        "pdf_finalization_failed",
        "The official Work Order PDF could not be finalized. Please try again.",
      );
    case "finish_outcome_unknown":
      return failure(
        "finish_outcome_unknown",
        "The finalization result could not be confirmed. Reload the Work Order before trying again.",
      );
    case "finish_response_invalid":
      return failure(
        "finish_response_invalid",
        "The Work Order was finalized, but its latest state could not be confirmed.",
      );
    default:
      return failure(
        "finish_failed",
        "The Work Order could not be finished. Please try again.",
      );
  }
}

export async function finishWorkOrder(
  input: FinishWorkOrderInput,
): Promise<FinishWorkOrderResult> {
  if (!isWorkOrderId(input.workOrderId) || !isTimestamp(input.expectedUpdatedAt)) {
    return mapError("invalid_request");
  }
  if (input.actualGoodQuantity !== undefined && !/^(0|[1-9][0-9]*)$/.test(input.actualGoodQuantity)) {
    return mapError("invalid_actual_good_quantity");
  }

  try {
    const { data, error } = await supabase.functions.invoke(
      "finish-work-order",
      {
        body: {
          workOrderId: input.workOrderId,
          expectedUpdatedAt: input.expectedUpdatedAt,
          ...(input.actualGoodQuantity === undefined
            ? {}
            : { actualGoodQuantity: input.actualGoodQuantity }),
        },
      },
    );

    if (error) return mapError(await readErrorCode(error));

    const parsed = parseSuccess(data, input.workOrderId);
    return parsed ? { ok: true, value: parsed } : mapError(null);
  } catch {
    return mapError(null);
  }
}
