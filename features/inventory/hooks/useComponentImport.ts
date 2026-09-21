import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryCommitmentsQueryKey } from "../inventoryCommitmentQueryKeys";
import { productListQueryPrefix } from "../productQueryKeys";
import { importComponents } from "../services/componentImportService";

export function useComponentImport() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  async function importBatch(input: Parameters<typeof importComponents>[0]) {
    const result = await importComponents(input);
    if (result.ok) {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: productListQueryPrefix(profile?.id),
        }),
        queryClient.invalidateQueries({
          queryKey: inventoryCommitmentsQueryKey(profile?.id),
          exact: true,
        }),
      ]);
    }
    return result;
  }

  return { importBatch };
}
