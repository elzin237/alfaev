import { useEffect } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { isTestCalculationImportEnabled } from "../../../app/config/testCalculationImportActivation";
import { getTestConversions } from "../services/testCalculationConversionService";
import { testCalculationImportPrefix } from "../testCalculationImportQueryKeys";
import { historyTimestampMicros } from "../services/testCalculationHistoryService";
import { testUuid } from "../services/testCalculationSaveService";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
export function useTestConversions(ids: readonly string[], enabled = true, commitments = false) {
  const auth = useAuth(), released = isTestCalculationImportEnabled();
  const allowed = released && enabled && !auth.isLoading && !auth.error && auth.isActive && Boolean(auth.session?.access_token && auth.profile?.isActive && auth.profile.authUserId === auth.session.user.id && testUuid(auth.session.user.id) && testUuid(auth.profile.id));
  const destinationPermission = useQuery({ queryKey: permissionQueryKey(auth.session?.user.id,auth.profile?.id,"pcb.view"),
    queryFn: () => hasPermission("pcb.view"), enabled: allowed && !auth.isAdmin, retry: false, staleTime: 0 });
  const checked = allowed && (auth.isAdmin || destinationPermission.isFetchedAfterMount && !destinationPermission.isFetching);
  const destinationAllowed = Boolean(auth.isAdmin || destinationPermission.isFetchedAfterMount && !destinationPermission.isFetching && !destinationPermission.isError && destinationPermission.data?.ok && destinationPermission.data.value);
  const validIds = [...new Set(ids)].filter(testUuid).sort(), chunks: string[][] = [];
  if (checked && validIds.length === ids.length) for (let i=0;i<validIds.length;i+=100) chunks.push(validIds.slice(i,i+100));
  const queries = useQueries({ queries: chunks.map(chunk => ({
    queryKey: [...testCalculationImportPrefix({ authUserId: auth.session!.user.id, profileId: auth.profile!.id }), "metadata", destinationAllowed, commitments, chunk],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const received = performance.now();
      return { value: await getTestConversions(chunk,auth.session!.access_token,commitments,signal), received };
    },
    enabled: allowed, retry: false, staleTime: 0, refetchOnWindowFocus: "always" as const, refetchOnReconnect: "always" as const,
  })) });
  const snapshotReady = checked && validIds.length === ids.length && queries.every(q => q.isFetchedAfterMount && !q.isFetching && !q.isError && q.data);
  const remaining = (data: NonNullable<typeof queries[number]["data"]>) => data.value.next_expiry ?
    Number((historyTimestampMicros(data.value.next_expiry)!-historyTimestampMicros(data.value.as_of)!)/1000n) - (performance.now()-data.received) : Infinity;
  const ready = snapshotReady && queries.every(q => remaining(q.data!) > 0);
  useEffect(() => {
    if (!snapshotReady) return; let delay = Infinity;
    for (const q of queries) if (q.data?.value.next_expiry) {
      const duration = (historyTimestampMicros(q.data.value.next_expiry)! - historyTimestampMicros(q.data.value.as_of)!) / 1000n;
      delay = Math.min(delay,Number(duration > 2147483000n ? 2147483000n : duration) - (performance.now()-q.data.received));
    }
    if (!Number.isFinite(delay)) return;
    const timer=setTimeout(() => { for (const q of queries) void q.refetch(); },Math.max(1,delay)); return () => clearTimeout(timer);
  },[snapshotReady,queries.map(q => q.dataUpdatedAt).join(","),JSON.stringify(chunks)]);
  return { released, ready, error: queries.some(q => q.isError), rows: ready ? queries.flatMap(q => q.data!.value.rows).map(row => destinationAllowed ? row : {...row,can_navigate:false,destination:null}) : undefined,
    asOf: ready ? queries[0]?.data?.value.as_of : undefined, refresh: () => Promise.all(queries.map(q => q.refetch())) };
}
