import { supabase } from "../../lib/supabase/client";

export const ARCHIVE_PAGE_SIZE = 50;

export interface ArchiveAuditLogItem {
  auditLogId: string;
  actorUserId: string;
  actorFullName: string;
  actionType: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

export interface ArchiveCursor {
  createdAt: string;
  auditLogId: string;
}

export interface ArchivePageError {
  code: "archive_page_failed";
  message: string;
}

export type ArchivePageResult =
  | { ok: true; value: ArchiveAuditLogItem[] }
  | { ok: false; error: ArchivePageError };

const rowKeys = [
  "action_type",
  "actor_full_name",
  "actor_user_id",
  "audit_log_id",
  "created_at",
  "entity_id",
  "entity_type",
  "summary",
] as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function parseArchiveRow(value: unknown): ArchiveAuditLogItem | null {
  if (!isRecord(value)) return null;
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== rowKeys.length ||
    actualKeys.some((key, index) => key !== [...rowKeys].sort()[index]) ||
    !isUuid(value.audit_log_id) ||
    !isUuid(value.actor_user_id) ||
    !isTrimmedNonblank(value.actor_full_name) ||
    !isTrimmedNonblank(value.action_type) ||
    !isTrimmedNonblank(value.entity_type) ||
    (value.entity_id !== null && !isUuid(value.entity_id)) ||
    !isTrimmedNonblank(value.summary) ||
    !isTimestamp(value.created_at)
  ) {
    return null;
  }

  return {
    auditLogId: value.audit_log_id,
    actorUserId: value.actor_user_id,
    actorFullName: value.actor_full_name,
    actionType: value.action_type,
    entityType: value.entity_type,
    entityId: value.entity_id,
    summary: value.summary,
    createdAt: value.created_at,
  };
}

function failure(): ArchivePageResult {
  return {
    ok: false,
    error: {
      code: "archive_page_failed",
      message: "Archive activity could not be loaded.",
    },
  };
}

export async function listAuditLogPage(
  cursor: ArchiveCursor | null = null,
): Promise<ArchivePageResult> {
  try {
    const { data, error } = await supabase.rpc("list_audit_log_page", {
      p_limit: ARCHIVE_PAGE_SIZE,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.auditLogId ?? null,
    });

    if (error || !Array.isArray(data)) return failure();

    const rows: ArchiveAuditLogItem[] = [];
    for (const value of data) {
      const row = parseArchiveRow(value);
      if (!row) return failure();
      rows.push(row);
    }

    return { ok: true, value: rows };
  } catch {
    return failure();
  }
}
