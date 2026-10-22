import { supabase } from "../../../lib/supabase/client";
import { isPcbCardId } from "./pcbBomService";

export interface PcbBomVersionHistoryItem {
  versionId: string;
  versionNumber: string;
  isActive: boolean;
  createdAt: string;
  createdByUserId: string;
  createdByFullName: string;
  productionUsed: boolean;
}

export type PcbBomHistoryResult =
  | { ok: true; value: PcbBomVersionHistoryItem[] }
  | { ok: false; error: { code: "not_found" | "access_denied" | "history_failed"; message: string } };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const maxBigint = 9223372036854775807n;
const historyFailed = { code: "history_failed", message: "PCB BOM history could not be loaded." } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRow(value: unknown): PcbBomVersionHistoryItem | null {
  if (!isRecord(value) || typeof value.bom_version_id !== "string" ||
    !uuidPattern.test(value.bom_version_id) ||
    typeof value.version_number !== "string" ||
    !/^[1-9][0-9]*$/.test(value.version_number) ||
    BigInt(value.version_number) > maxBigint ||
    typeof value.is_active !== "boolean" ||
    typeof value.created_at !== "string" ||
    !timestampPattern.test(value.created_at) ||
    Number.isNaN(Date.parse(value.created_at)) ||
    typeof value.created_by_user_id !== "string" ||
    !uuidPattern.test(value.created_by_user_id) ||
    typeof value.created_by_full_name !== "string" ||
    value.created_by_full_name.length === 0 ||
    value.created_by_full_name !== value.created_by_full_name.trim() ||
    typeof value.production_used !== "boolean") {
    return null;
  }
  return {
    versionId: value.bom_version_id,
    versionNumber: value.version_number,
    isActive: value.is_active,
    createdAt: value.created_at,
    createdByUserId: value.created_by_user_id,
    createdByFullName: value.created_by_full_name,
    productionUsed: value.production_used,
  };
}

export async function listPcbBomVersions(cardId: string): Promise<PcbBomHistoryResult> {
  if (!isPcbCardId(cardId)) {
    return { ok: false, error: { code: "not_found", message: "Finished-product definition not found." } };
  }
  const { data, error } = await supabase.rpc("list_pcb_bom_versions", { p_pcb_card_id: cardId });
  if (error?.code === "P0002") {
    return { ok: false, error: { code: "not_found", message: "Finished-product definition not found." } };
  }
  if (error?.code === "42501") {
    return { ok: false, error: { code: "access_denied", message: "You cannot view this PCB BOM history." } };
  }
  if (error || !Array.isArray(data)) return { ok: false, error: historyFailed };

  const versions: PcbBomVersionHistoryItem[] = [];
  const seenIds = new Set<string>();
  const seenNumbers = new Set<string>();
  for (const value of data) {
    const version = parseRow(value);
    if (!version || seenIds.has(version.versionId) || seenNumbers.has(version.versionNumber) ||
      (versions.length > 0 && BigInt(versions[versions.length - 1]!.versionNumber) <= BigInt(version.versionNumber))) {
      return { ok: false, error: historyFailed };
    }
    seenIds.add(version.versionId);
    seenNumbers.add(version.versionNumber);
    versions.push(version);
  }
  return { ok: true, value: versions };
}
