import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import {
  normalizeProcurementSearch,
  procurementListQueryKey,
  procurementSupplierOptionsQueryKey,
  type ProcurementListFilters,
} from "../procurementQueryKeys";
import {
  listProcurementSupplierOptions,
  searchProcurementRequests,
} from "../services/procurementService";

export function useProcurementRequests(filters: ProcurementListFilters) {
  const { profile } = useAuth();
  const normalizedFilters = {
    ...filters,
    search: normalizeProcurementSearch(filters.search),
  };

  return useQuery({
    queryKey: procurementListQueryKey(profile?.id, normalizedFilters),
    queryFn: () => searchProcurementRequests(normalizedFilters),
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}

export function useProcurementSupplierOptions() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: procurementSupplierOptionsQueryKey(profile?.id),
    queryFn: listProcurementSupplierOptions,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
