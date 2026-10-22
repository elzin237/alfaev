import { supabase } from "../../../lib/supabase/client";
import { isPcbCardId } from "./pcbBomService";

export interface PcbProductionHistoryItem {
  productionRunId: string;
  completedAt: string;
  quantityProduced: string;
  projectId: string | null;
  projectName: string | null;
  bomVersionId: string;
  bomVersionNumber: string;
  producedByUserId: string;
  producedByFullName: string;
}

export type PcbProductionHistoryResult =
  | { ok: true; value: PcbProductionHistoryItem[] }
  | { ok: false; error: { code: "not_found" | "access_denied" | "history_failed"; message: string } };

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const maxBigint = 9223372036854775807n;
const historyFailed = { code: "history_failed", message: "PCB production history could not be loaded." } as const;
const allowedKeys = new Set([
  "production_run_id", "completed_at", "quantity_produced", "project_id", "project_name",
  "bom_version_id", "bom_version_number", "produced_by_user_id", "produced_by_full_name",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveBigintText(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= maxBigint;
}

function isNonnegativeBigintText(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= maxBigint;
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && isPcbCardId(value);
}

function parseRow(value: unknown): PcbProductionHistoryItem | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    !isUuid(value.production_run_id) ||
    typeof value.completed_at !== "string" || !timestampPattern.test(value.completed_at) ||
    Number.isNaN(Date.parse(value.completed_at)) ||
    !isNonnegativeBigintText(value.quantity_produced) ||
    !((value.project_id === null && value.project_name === null) ||
      (isUuid(value.project_id) && isName(value.project_name))) ||
    !isUuid(value.bom_version_id) ||
    !isPositiveBigintText(value.bom_version_number) ||
    !isUuid(value.produced_by_user_id) ||
    !isName(value.produced_by_full_name)) return null;
  return {
    productionRunId: value.production_run_id,
    completedAt: value.completed_at,
    quantityProduced: value.quantity_produced,
    projectId: value.project_id as string | null,
    projectName: value.project_name as string | null,
    bomVersionId: value.bom_version_id,
    bomVersionNumber: value.bom_version_number,
    producedByUserId: value.produced_by_user_id,
    producedByFullName: value.produced_by_full_name,
  };
}

export async function listPcbProductionHistory(cardId: string): Promise<PcbProductionHistoryResult> {
  if (!isPcbCardId(cardId)) return { ok: false, error: { code: "not_found", message: "Finished-product definition not found." } };
  const { data, error } = await supabase.rpc("list_pcb_production_history", { p_pcb_card_id: cardId });
  if (error?.code === "P0002") return { ok: false, error: { code: "not_found", message: "Finished-product definition not found." } };
  if (error?.code === "42501") {
    return { ok: false, error: { code: "access_denied", message: "You cannot view this PCB production history." } };
  }
  if (error || !Array.isArray(data)) return { ok: false, error: historyFailed };
  const items: PcbProductionHistoryItem[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    const item = parseRow(row);
    if (!item || seen.has(item.productionRunId)) return { ok: false, error: historyFailed };
    seen.add(item.productionRunId);
    items.push(item);
  }
  return { ok: true, value: items };
}
