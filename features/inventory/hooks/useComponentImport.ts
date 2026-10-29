import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryCommitmentsQueryKey } from "../inventoryCommitmentQueryKeys";
import { productListQueryPrefix } from "../productQueryKeys";
import { importComponents } from "../services/componentImportService";
import { inventoryTestCommitmentsPrefix } from "../../test-calculator/services/testCalculationRecoveryStore";

export function useComponentImport() {
  const { session, profile } = useAuth();
  const queryClient = useQueryClient();

  async function importBatch(input: Parameters<typeof importComponents>[0]) {
    const identity = session?.user.id && profile?.isActive && profile.authUserId === session.user.id
      ? { authUserId: session.user.id, profileId: profile.id } : null;
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
        ...(identity ? [queryClient.invalidateQueries({ queryKey: inventoryTestCommitmentsPrefix(identity) })] : []),
      ]);
    }
    return result;
  }

  return { importBatch };
}
