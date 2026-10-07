import { parseDateOnly } from "../../shared/utils/dateOnly";

export interface ArchiveFilters {
  createdFrom: string | null;
  createdBefore: string | null;
  actorUserId: string | null;
  entityType: string | null;
  actionType: string | null;
  searchText: string | null;
}

export const EMPTY_ARCHIVE_FILTERS: ArchiveFilters = {
  createdFrom: null,
  createdBefore: null,
  actorUserId: null,
  entityType: null,
  actionType: null,
  searchText: null,
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function normalizeArchiveFilters(filters: ArchiveFilters): ArchiveFilters {
  return {
    createdFrom: filters.createdFrom,
    createdBefore: filters.createdBefore,
    actorUserId: filters.actorUserId,
    entityType: normalizeOptionalText(filters.entityType),
    actionType: normalizeOptionalText(filters.actionType),
    searchText: normalizeOptionalText(filters.searchText),
  };
}

export function localDateStartAsUtc(
  value: string,
  nextDay = false,
): string | null {
  const parsed = parseDateOnly(value);
  if (!parsed) return null;
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day + (nextDay ? 1 : 0),
    0,
    0,
    0,
    0,
  ).toISOString();
}

export function countActiveArchiveFilters(filters: ArchiveFilters): number {
  return [
    filters.searchText,
    filters.createdFrom,
    filters.createdBefore,
    filters.actorUserId,
    filters.entityType,
    filters.actionType,
  ].filter((value) => value !== null && value !== "").length;
}
