import type {QueryClient} from "@tanstack/react-query";
import {isWorkOrderCommitmentReadsEnabled} from "../../app/config/workOrderCommitmentReadsActivation";
import {inventoryReservationAccountingPrefix} from "./services/inventoryReservationAccountingService";
import {inventoryCommitmentBreakdownPrefix} from "./services/inventoryCommitmentBreakdownService";
import {workOrderListQueryKey} from "../work-orders/workOrderQueryKeys";
import {isUnifiedCommittedEnabled} from "../../app/config/unifiedCommittedActivation";
import {unifiedCommittedPrefix} from "./services/unifiedCommittedService";

// Mounted reads already observe the normal Work Order list invalidation. If that
// query was never cached, React Query emits no invalidation event: refresh only
// the new, actor/profile/backend-scoped readers directly in that case.
export async function refreshUnsignalledWorkOrderCommitments(client:QueryClient,actor:string|undefined,profile:string|undefined){
  if((!isWorkOrderCommitmentReadsEnabled()&&!isUnifiedCommittedEnabled())||!actor||!profile||client.getQueryCache().find({queryKey:workOrderListQueryKey(profile),exact:true}))return;
  await Promise.all([
    ...(isWorkOrderCommitmentReadsEnabled()?[client.invalidateQueries({queryKey:inventoryReservationAccountingPrefix(actor,profile)})]:[]),
    client.invalidateQueries({queryKey:inventoryCommitmentBreakdownPrefix(actor,profile)}),
    ...(isUnifiedCommittedEnabled()?[client.invalidateQueries({queryKey:unifiedCommittedPrefix(actor,profile)})]:[]),
  ]);
}
