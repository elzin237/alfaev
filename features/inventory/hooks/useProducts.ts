import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import {
  normalizeProductSearch,
  productListQueryKey,
} from "../productQueryKeys";
import { listProducts } from "../services/productService";

export function useProducts(warehouseId: string, search = "", enabled = true) {
  const { profile } = useAuth();
  const normalizedSearch = normalizeProductSearch(search);

  return useQuery({
    queryKey: productListQueryKey(profile?.id, warehouseId, normalizedSearch),
    queryFn: () => listProducts(warehouseId, normalizedSearch),
    enabled: Boolean(enabled && profile?.id && warehouseId),
    staleTime: 60_000,
  });
}
