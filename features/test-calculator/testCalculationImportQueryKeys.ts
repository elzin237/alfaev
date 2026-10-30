import type { QueryClient } from "@tanstack/react-query";
import { frontendEnv } from "../../lib/config/env";
import { pcbCardListQueryKey, pcbBomDetailQueryKey, pcbBomHistoryQueryKey } from "../pcb/pcbQueryKeys";
import { productListQueryPrefix } from "../inventory/productQueryKeys";
import { inventoryCommitmentsQueryKey } from "../inventory/inventoryCommitmentQueryKeys";
import { dashboardStockHealthPrefix, stockHealthPrefix } from "../inventory/stockHealthQueryKeys";
import { projectAlertQueryPrefix } from "../dashboard/projectAlertQueryKeys";
import { workOrderAvailabilityPrefix } from "../work-orders/hooks/useWorkOrderAvailability";
import { testCalculationHistoryPrefix, inventoryTestCommitmentsPrefix, type TestRecoveryIdentity } from "./services/testCalculationRecoveryStore";
import type { TestImportReceipt } from "./services/testCalculationImportService";

export const testCalculationImportPrefix = (identity: TestRecoveryIdentity) =>
  ["test-calculation-imports", new URL(frontendEnv.supabaseUrl).origin, identity.authUserId, identity.profileId] as const;
export async function invalidateTestImport(client: QueryClient, identity: TestRecoveryIdentity, receipt: TestImportReceipt) {
  // Legacy profile-only keys belong to this app's single configured backend; never invalidate a different profile.
  const { authUserId: actor, profileId: profile } = identity;
  await Promise.all([
    pcbCardListQueryKey(profile), pcbBomDetailQueryKey(profile, receipt.pcb_card_id), pcbBomHistoryQueryKey(profile, receipt.pcb_card_id),
    ["pcb", "bom-choices", profile], ["pcb", "production-source", profile],
    testCalculationHistoryPrefix(identity), testCalculationImportPrefix(identity),
    productListQueryPrefix(profile), ["inventory", "products", "detail", profile], inventoryCommitmentsQueryKey(profile),
    inventoryTestCommitmentsPrefix(identity), stockHealthPrefix(actor, profile), dashboardStockHealthPrefix(actor, profile),
    ["test-calculator-products", actor, profile], ["test-calculation-preview", actor, profile],
    workOrderAvailabilityPrefix(actor, profile), projectAlertQueryPrefix(profile),
  ].map(queryKey => client.invalidateQueries({ queryKey }, { throwOnError: true })));
}
