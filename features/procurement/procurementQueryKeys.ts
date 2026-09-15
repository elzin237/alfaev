import type { ProcurementStatus } from "./procurementStatus";

export interface ProcurementListFilters {
  search: string;
  status: ProcurementStatus | null;
  supplierId: string | null;
}

export function normalizeProcurementSearch(search: string): string {
  return search.trim();
}

export function procurementQueryPrefix(profileId: string | undefined) {
  return ["procurement", profileId] as const;
}

export function procurementListQueryPrefix(profileId: string | undefined) {
  return [...procurementQueryPrefix(profileId), "list"] as const;
}

export function procurementListQueryKey(
  profileId: string | undefined,
  filters: ProcurementListFilters,
) {
  return [
    ...procurementListQueryPrefix(profileId),
    normalizeProcurementSearch(filters.search),
    filters.status ?? "all",
    filters.supplierId ?? "all",
  ] as const;
}

export function procurementSupplierOptionsQueryKey(
  profileId: string | undefined,
) {
  return [...procurementQueryPrefix(profileId), "supplier-options"] as const;
}

export function procurementBadgeQueryKey(profileId: string | undefined) {
  return [...procurementQueryPrefix(profileId), "badge"] as const;
}
