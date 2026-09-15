import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { brandListQueryKey } from "../../inventory/brandQueryKeys";
import { productListQueryPrefix } from "../../inventory/productQueryKeys";
import { listBrands } from "../../inventory/services/brandService";
import { procurementListQueryPrefix } from "../procurementQueryKeys";
import { createProductFromProcurementRequest } from "../services/procurementService";

export function useProcurementProductCreation(loadBrands: boolean) {
  const { session, profile, isAdmin, isLoading, error } = useAuth();
  const queryClient = useQueryClient();
  const canCreateProduct = Boolean(
    !isLoading && !error && session && profile?.isActive && isAdmin,
  );
  const brandsQuery = useQuery({
    queryKey: brandListQueryKey(profile?.id),
    queryFn: listBrands,
    enabled: Boolean(loadBrands && canCreateProduct && profile?.id),
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: createProductFromProcurementRequest,
    onSuccess: async (result) => {
      if (!result.ok) return;

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: procurementListQueryPrefix(profile?.id),
        }),
        queryClient.invalidateQueries({
          queryKey: productListQueryPrefix(profile?.id),
        }),
      ]);
    },
  });

  return {
    brandsQuery,
    canCreateProduct,
    createProduct: mutation.mutateAsync,
  };
}
