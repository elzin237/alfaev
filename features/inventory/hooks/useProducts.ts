import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { productListQueryKey } from "../productQueryKeys";
import { listProducts } from "../services/productService";

export function useProducts() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: productListQueryKey(profile?.id),
    queryFn: listProducts,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });
}
