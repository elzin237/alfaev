import { supabase } from "../../lib/supabase/client";
import {
  EMPTY_ARCHIVE_FILTERS,
  normalizeArchiveFilters,
  type ArchiveFilters,
} from "./archiveFilters";

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

export interface ArchiveActorOption {
  userId: string;
  fullName: string;
}

export interface ArchiveFilterOptions {
  actors: ArchiveActorOption[];
  entityTypes: string[];
  actionTypes: string[];
}

export interface ArchiveFilterOptionsError {
  code: "archive_filter_options_failed";
  message: string;
}

export type ArchiveFilterOptionsResult =
  | { ok: true; value: ArchiveFilterOptions }
  | { ok: false; error: ArchiveFilterOptionsError };

export type ArchiveContextKind =
  | "project"
  | "supplier"
  | "product"
  | "pcb_card"
  | "work_order"
  | "user_profile";

export type ArchiveJsonValue =
  | null
  | boolean
  | number
  | string
  | ArchiveJsonValue[]
  | { [key: string]: ArchiveJsonValue };

export interface ArchiveAuditLogDetail extends ArchiveAuditLogItem {
  beforeData: ArchiveJsonValue;
  afterData: ArchiveJsonValue;
  metadata: ArchiveJsonValue;
  detailAuthorized: boolean;
  targetViewAuthorized: boolean;
  contextKind: ArchiveContextKind | null;
  contextId: string | null;
}

export interface ArchiveDetailError {
  code: "archive_detail_failed";
  message: string;
}

export type ArchiveDetailResult =
  | { ok: true; value: ArchiveAuditLogDetail }
  | { ok: false; error: ArchiveDetailError };

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
const contextKinds = new Set<ArchiveContextKind>([
  "project",
  "supplier",
  "product",
  "pcb_card",
  "work_order",
  "user_profile",
]);

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

function isArchiveJsonValue(value: unknown): value is ArchiveJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isArchiveJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isArchiveJsonValue);
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

function optionsFailure(): ArchiveFilterOptionsResult {
  return {
    ok: false,
    error: {
      code: "archive_filter_options_failed",
      message: "Archive filter options could not be loaded.",
    },
  };
}

function detailFailure(): ArchiveDetailResult {
  return {
    ok: false,
    error: {
      code: "archive_detail_failed",
      message: "Archive detail could not be loaded.",
    },
  };
}

function parseArchiveDetail(value: unknown): ArchiveAuditLogDetail | null {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    ...rowKeys,
    "after_data",
    "before_data",
    "context_id",
    "context_kind",
    "detail_authorized",
    "metadata",
    "target_view_authorized",
  ].sort();
  const actualKeys = Object.keys(value).sort();
  const listRow = parseArchiveRow(Object.fromEntries(
    rowKeys.map((key) => [key, value[key]]),
  ));
  const contextKind = value.context_kind;
  const contextId = value.context_id;
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    !listRow ||
    typeof value.detail_authorized !== "boolean" ||
    typeof value.target_view_authorized !== "boolean" ||
    !isArchiveJsonValue(value.before_data) ||
    !isArchiveJsonValue(value.after_data) ||
    !isArchiveJsonValue(value.metadata) ||
    (contextKind !== null && (
      typeof contextKind !== "string" ||
      !contextKinds.has(contextKind as ArchiveContextKind)
    )) ||
    (contextId !== null && !isUuid(contextId)) ||
    ((contextKind === null) !== (contextId === null)) ||
    (value.target_view_authorized !== (contextKind !== null)) ||
    (!value.detail_authorized && (
      value.before_data !== null ||
      value.after_data !== null ||
      value.metadata !== null ||
      value.target_view_authorized
    ))
  ) return null;

  return {
    ...listRow,
    beforeData: value.before_data,
    afterData: value.after_data,
    metadata: value.metadata,
    detailAuthorized: value.detail_authorized,
    targetViewAuthorized: value.target_view_authorized,
    contextKind: contextKind as ArchiveContextKind | null,
    contextId,
  };
}

function parseUniqueTextArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isTrimmedNonblank(item) || seen.has(item)) return null;
    seen.add(item);
    values.push(item);
  }
  return values;
}

function parseArchiveFilterOptions(value: unknown): ArchiveFilterOptions | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "action_types,actors,entity_types" || !Array.isArray(value.actors)) {
    return null;
  }
  const actors: ArchiveActorOption[] = [];
  const actorIds = new Set<string>();
  for (const actorValue of value.actors) {
    if (
      !isRecord(actorValue) ||
      Object.keys(actorValue).sort().join(",") !== "full_name,user_id" ||
      !isUuid(actorValue.user_id) ||
      !isTrimmedNonblank(actorValue.full_name) ||
      actorIds.has(actorValue.user_id)
    ) return null;
    actorIds.add(actorValue.user_id);
    actors.push({ userId: actorValue.user_id, fullName: actorValue.full_name });
  }
  const entityTypes = parseUniqueTextArray(value.entity_types);
  const actionTypes = parseUniqueTextArray(value.action_types);
  return entityTypes && actionTypes ? { actors, entityTypes, actionTypes } : null;
}

export async function listAuditLogPage(
  filters: ArchiveFilters = EMPTY_ARCHIVE_FILTERS,
  cursor: ArchiveCursor | null = null,
): Promise<ArchivePageResult> {
  try {
    const normalized = normalizeArchiveFilters(filters);
    const { data, error } = await supabase.rpc("list_audit_log_page", {
      p_limit: ARCHIVE_PAGE_SIZE,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.auditLogId ?? null,
      p_created_from: normalized.createdFrom,
      p_created_before: normalized.createdBefore,
      p_actor_user_id: normalized.actorUserId,
      p_entity_type: normalized.entityType,
      p_action_type: normalized.actionType,
      p_search_text: normalized.searchText,
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

export async function getAuditLogFilterOptions(): Promise<ArchiveFilterOptionsResult> {
  try {
    const { data, error } = await supabase.rpc("get_audit_log_filter_options");
    if (error) return optionsFailure();
    const options = parseArchiveFilterOptions(data);
    return options ? { ok: true, value: options } : optionsFailure();
  } catch {
    return optionsFailure();
  }
}

export async function getAuditLogDetail(
  auditLogId: string,
): Promise<ArchiveDetailResult> {
  try {
    const { data, error } = await supabase.rpc("get_audit_log_detail", {
      p_audit_log_id: auditLogId,
    });
    if (error || !Array.isArray(data) || data.length !== 1) return detailFailure();
    const detail = parseArchiveDetail(data[0]);
    return detail ? { ok: true, value: detail } : detailFailure();
  } catch {
    return detailFailure();
  }
}
