import { supabase } from "../../../lib/supabase/client";
import { isWorkOrderId } from "./workOrderService";

export interface WorkOrderPdfAccess {
  signedUrl: string;
  expiresIn: 300;
}

export interface WorkOrderPdfAccessError {
  code:
    | "access_denied"
    | "invalid_request"
    | "pdf_access_failed"
    | "pdf_not_found"
    | "work_order_not_finished"
    | "work_order_not_found";
  message: string;
}

export type WorkOrderPdfAccessResult =
  | { ok: true; value: WorkOrderPdfAccess }
  | { ok: false; error: WorkOrderPdfAccessError };

const successKeys = new Set(["signedUrl", "expiresIn"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSignedUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username === "" && url.password === "" && url.hash === "" &&
      url.searchParams.has("token");
  } catch {
    return false;
  }
}

function parseSuccess(value: unknown): WorkOrderPdfAccess | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== successKeys.size ||
    Object.keys(value).some((key) => !successKeys.has(key)) ||
    !isSignedUrl(value.signedUrl) ||
    value.expiresIn !== 300
  ) return null;
  return { signedUrl: value.signedUrl, expiresIn: 300 };
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
  code: WorkOrderPdfAccessError["code"],
  message: string,
): WorkOrderPdfAccessResult {
  return { ok: false, error: { code, message } };
}

function mapError(code: string | null): WorkOrderPdfAccessResult {
  if (code === "unauthenticated" || code === "access_denied") {
    return failure(
      "access_denied",
      "You no longer have permission to view this Work Order PDF.",
    );
  }
  if (code === "work_order_not_found") {
    return failure("work_order_not_found", "The Work Order could not be found.");
  }
  if (code === "work_order_not_finished") {
    return failure(
      "work_order_not_finished",
      "The Work Order is not Finished.",
    );
  }
  if (code === "pdf_not_found") {
    return failure(
      "pdf_not_found",
      "The official Work Order PDF could not be found.",
    );
  }
  if (code === "invalid_request") {
    return failure("invalid_request", "The Work Order PDF request is invalid.");
  }
  return failure(
    "pdf_access_failed",
    "The official Work Order PDF could not be opened. Please try again.",
  );
}

export async function getWorkOrderPdfAccess(
  workOrderId: string,
): Promise<WorkOrderPdfAccessResult> {
  if (!isWorkOrderId(workOrderId)) return mapError("invalid_request");
  try {
    const { data, error } = await supabase.functions.invoke(
      "work-order-pdf-access",
      { body: { workOrderId } },
    );
    if (error) return mapError(await readErrorCode(error));
    const parsed = parseSuccess(data);
    return parsed ? { ok: true, value: parsed } : mapError(null);
  } catch {
    return mapError(null);
  }
}
