import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "../../../app/auth/AuthProvider";
import { inventoryTestCommitmentsPrefix } from "../../test-calculator/services/testCalculationRecoveryStore";
import { historyTimestampMicros } from "../../test-calculator/services/testCalculationHistoryService";
import { testUuid } from "../../test-calculator/services/testCalculationSaveService";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import { getInventoryTestCommitments, inventoryTestFailure, type InventoryTestCommitment } from "../services/inventoryTestCommitmentService";

function lifetime(rows: InventoryTestCommitment[]) {
  let delay = Infinity;
  for (const row of rows) if (row.nextExpiry !== null) {
    const micros = historyTimestampMicros(row.nextExpiry)! - historyTimestampMicros(row.asOf)!;
    // Only timer durations become numbers. Authoritative quantities never do.
    delay = Math.min(delay, Number(micros > 2_147_000_000_000n ? 2_147_000_000n : micros / 1000n));
  }
  return delay;
}

export function useInventoryTestCommitments(warehouseId: string, search: string, canRead: boolean, enabledAfterActivation = false) {
  const { session, profile, isActive, isLoading, error } = useAuth();
  const [visibility, setVisibility] = useState({ visible: !document.hidden, epoch: 0 });
  const [expired, setExpired] = useState<unknown>(null);
  useEffect(() => {
    const changed = () => setVisibility(v => ({ visible: !document.hidden, epoch: v.epoch + 1 }));
    const blurred = () => setVisibility(v => ({ visible: false, epoch: v.epoch + 1 }));
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("blur", blurred);
    window.addEventListener("focus", changed);
    return () => {
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("blur", blurred);
      window.removeEventListener("focus", changed);
    };
  }, []);
  const allowed = enabledAfterActivation && canRead && !isLoading && !error && isActive &&
    Boolean(session?.access_token && profile?.isActive && profile.authUserId === session.user.id &&
      testUuid(profile.id) && testUuid(session.user.id) && INVENTORY_WAREHOUSES.some(w => w.id === warehouseId));
  const identity = allowed ? { authUserId: session!.user.id, profileId: profile!.id } : null;
  const query = useQuery({
    queryKey: [...(identity ? inventoryTestCommitmentsPrefix(identity) : ["inventory-test-commitments", "disabled", session?.user.id, profile?.id]), warehouseId, search, visibility.epoch],
    queryFn: async ({ signal }) => {
      const started = performance.now();
      const result = allowed && visibility.visible && !document.hidden ? await getInventoryTestCommitments(warehouseId, search, session!.access_token, signal) : inventoryTestFailure(true);
      // A response arriving after its earliest expiry cannot be shown as current.
      return { result: result.ok && lifetime(result.value) <= performance.now() - started ? inventoryTestFailure() : result, started };
    },
    enabled: Boolean(allowed && visibility.visible), retry: false, staleTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: "always", refetchOnReconnect: "always",
  });
  const data = query.data;
  useEffect(() => {
    if (!allowed || !visibility.visible || query.isFetching || !data?.result.ok || expired === data) return;
    const delay = lifetime(data.result.value) - (performance.now() - data.started);
    if (!Number.isFinite(delay)) return;
    const timer = setTimeout(() => { setExpired(data); void query.refetch(); }, Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [allowed, visibility.visible, query.isFetching, data, expired, query.refetch]);
  const fresh = allowed && visibility.visible && !document.hidden && query.isFetchedAfterMount && !query.isFetching && !query.isError &&
    data?.result.ok && expired !== data && lifetime(data.result.value) > performance.now() - data.started;
  return { allowed, query, rows: fresh && data?.result.ok ? data.result.value : undefined };
}
