import { supabase } from "../../../lib/supabase/client";
import { isProjectId } from "./projectService";

export interface ProjectMaterialUsage {
  productId: string;
  serialNumber: string;
  productName: string;
  quantity: string;
}

export interface ProjectMaterialUsageError {
  code:
    | "access_denied"
    | "invalid_request"
    | "project_not_found"
    | "project_usage_load_failed";
  message: string;
}

export type ProjectMaterialUsageResult =
  | { ok: true; value: ProjectMaterialUsage[] }
  | { ok: false; error: ProjectMaterialUsageError };

const allowedKeys = new Set([
  "product_id",
  "serial_number",
  "product_name",
  "quantity",
]);
const serialNumberPattern = /^(?:[0-9]{3}|[0-9]{7})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function parsePositiveBigintText(value: unknown): string | null {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
}

function loadFailure(code?: string): ProjectMaterialUsageError {
  if (code === "42501") return {
    code: "access_denied",
    message: "You no longer have permission to view this Project's material usage.",
  };
  if (code === "22023") return {
    code: "invalid_request",
    message: "The Project material usage request is invalid.",
  };
  if (code === "P0002") return {
    code: "project_not_found",
    message: "The Project could not be found.",
  };
  return {
    code: "project_usage_load_failed",
    message: "Project material usage could not be loaded. Please try again.",
  };
}

function parseUsageRow(
  value: unknown,
): ProjectMaterialUsage | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== allowedKeys.size ||
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    typeof value.product_id !== "string" ||
    !isProjectId(value.product_id) ||
    typeof value.serial_number !== "string" ||
    !serialNumberPattern.test(value.serial_number) ||
    !isTrimmedNonblank(value.product_name)
  ) return null;

  const quantity = parsePositiveBigintText(value.quantity);
  if (quantity === null) return null;

  return {
    productId: value.product_id,
    serialNumber: value.serial_number,
    productName: value.product_name,
    quantity,
  };
}

export async function listProjectMaterialUsage(
  projectId: string,
): Promise<ProjectMaterialUsageResult> {
  if (!isProjectId(projectId)) {
    return { ok: false, error: loadFailure("22023") };
  }

  try {
    const { data, error } = await supabase.rpc(
      "list_project_material_usage",
      { p_project_id: projectId },
    );
    if (error) return { ok: false, error: loadFailure(error.code) };
    if (!Array.isArray(data)) {
      return { ok: false, error: loadFailure() };
    }

    const usage: ProjectMaterialUsage[] = [];
    for (const row of data) {
      const parsed = parseUsageRow(row);
      if (!parsed) return { ok: false, error: loadFailure() };
      usage.push(parsed);
    }
    return { ok: true, value: usage };
  } catch {
    return { ok: false, error: loadFailure() };
  }
}
