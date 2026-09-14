import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import {
  normalizeProductSearch,
  productListQueryKey,
} from "../productQueryKeys";
import { listProducts } from "../services/productService";

export function useProducts(search = "") {
  const { profile } = useAuth();
  const normalizedSearch = normalizeProductSearch(search);

  return useQuery({
    queryKey: productListQueryKey(profile?.id, normalizedSearch),
    queryFn: () => listProducts(normalizedSearch),
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
