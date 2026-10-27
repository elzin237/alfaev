import { supabase } from "../../../lib/supabase/client";
import { isProjectId } from "./projectService";

export interface ProjectFinishedGoods {
  productId: string;
  productName: string;
  serialNumber: string;
  plannedRequirement: bigint;
  actualProjectConsumption: bigint;
  outstandingDemand: bigint;
  physicalQuantity: bigint;
  globallyReservedQuantity: bigint;
  availableQuantity: bigint;
  projectReservedQuantity: bigint;
  reservationId: string | null;
  reservationVersion: bigint;
}

export type FinishedGoodsResult =
  | { ok: true; value: ProjectFinishedGoods[] }
  | { ok: false; error: { code: "access_denied" | "invalid_request" | "project_not_found" | "not_available" | "load_failed"; message: string } };

// PostgREST casts table-valued RPC response columns before JSON serialization.
// Casting AFTER JSON.parse/Number conversion would already have lost precision.
// https://docs.postgrest.org/en/v12/references/api/tables_views.html#casting-columns
export const finishedGoodsProjection = "product_id,product_name,serial_number,planned_requirement::text,actual_project_consumption::text,outstanding_demand::text,physical_quantity::text,globally_reserved_quantity::text,available_quantity::text,project_reserved_quantity::text,reservation_id,reservation_version::text";
const keys = new Set(finishedGoodsProjection.split(",").map(field => field.replace("::text", "")));
const bigintMax = 9223372036854775807n;

function quantity(value: unknown, bounded = false): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = BigInt(value);
  return bounded && parsed > bigintMax ? null : parsed;
}

function parseRow(value: unknown): ProjectFinishedGoods | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.size || Object.keys(row).some(key => !keys.has(key)) ||
    typeof row.product_id !== "string" || !isProjectId(row.product_id) ||
    typeof row.product_name !== "string" || !row.product_name.trim() || row.product_name.trim() !== row.product_name ||
    typeof row.serial_number !== "string" || !/^(?:[0-9]{3}|[0-9]{7})$/.test(row.serial_number)) return null;

  const planned = quantity(row.planned_requirement), consumed = quantity(row.actual_project_consumption);
  const outstanding = quantity(row.outstanding_demand);
  const physical = quantity(row.physical_quantity, true), globalReserved = quantity(row.globally_reserved_quantity, true);
  const available = quantity(row.available_quantity, true), own = quantity(row.project_reserved_quantity, true);
  const version = quantity(row.reservation_version, true);
  if (planned === null || planned <= 0n || consumed === null || outstanding === null || physical === null ||
    globalReserved === null || available === null || own === null || version === null ||
    outstanding !== (planned > consumed ? planned - consumed : 0n) ||
    available !== physical - globalReserved || own > globalReserved || own > outstanding) return null;
  if (row.reservation_id === null) {
    if (version !== 0n || own !== 0n) return null;
  } else if (typeof row.reservation_id !== "string" || !isProjectId(row.reservation_id) || version < 1n) return null;

  return { productId: row.product_id, productName: row.product_name, serialNumber: row.serial_number,
    plannedRequirement: planned, actualProjectConsumption: consumed, outstandingDemand: outstanding,
    physicalQuantity: physical, globallyReservedQuantity: globalReserved, availableQuantity: available,
    projectReservedQuantity: own, reservationId: row.reservation_id, reservationVersion: version };
}

function failure(code?: string): FinishedGoodsResult {
  if (code === "42501") return { ok: false, error: { code: "access_denied", message: "You do not have permission to view this Project's Finished Goods." } };
  if (code === "22023") return { ok: false, error: { code: "invalid_request", message: "The Project Finished Goods request is invalid." } };
  if (code === "P0002") return { ok: false, error: { code: "project_not_found", message: "The Project could not be found." } };
  if (code === "PGRST202" || code === "42883") return { ok: false, error: { code: "not_available", message: "Finished Goods reservation information is not available on this backend yet." } };
  return { ok: false, error: { code: "load_failed", message: "Project Finished Goods could not be loaded. Please try again." } };
}

export async function getProjectFinishedGoods(projectId: string, signal?: AbortSignal, accessToken?: string): Promise<FinishedGoodsResult> {
  if (!isProjectId(projectId)) return failure("22023");
  try {
    const query = supabase.rpc("get_project_finished_goods_reservation_context", { p_project_id: projectId })
      .select(finishedGoodsProjection);
    if (accessToken) query.setHeader("Authorization", `Bearer ${accessToken}`);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error) return failure(error.code);
    if (!Array.isArray(data)) return failure();
    const rows: ProjectFinishedGoods[] = [];
    for (const value of data) {
      const row = parseRow(value);
      if (!row || rows.some(existing => existing.productId === row.productId)) return failure();
      rows.push(row);
    }
    return { ok: true, value: rows };
  } catch { return failure(); }
}
