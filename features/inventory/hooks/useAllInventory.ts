import { useQueries } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { frontendEnv } from "../../../lib/config/env";
import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import { productListQueryPrefix } from "../productQueryKeys";
import { listCompleteWarehouseProducts, type ProductListItem } from "../services/productService";
import { useInventoryCommitments } from "./useInventoryCommitments";
import { useInventoryTestCommitments } from "./useInventoryTestCommitments";
import { useInventoryStockHealth } from "./useInventoryStockHealth";

export function useAllInventory(authorizedIds: readonly string[], search: string, warehouseFilter: string, testsEnabled: boolean) {
  const auth = useAuth();
  const active = Boolean(!auth.isLoading && !auth.error && auth.isActive && auth.profile?.isActive &&
    auth.session?.access_token && auth.profile.authUserId === auth.session.user.id);
  const warehouses = INVENTORY_WAREHOUSES.filter(w => active && authorizedIds.includes(w.id) && (warehouseFilter === "all" || warehouseFilter === w.code));
  const allowed = (index: number) => warehouses.some(w => w.id === INVENTORY_WAREHOUSES[index]!.id);
  const rawPlanning = allowed(0) && authorizedIds.includes(INVENTORY_WAREHOUSES[2]!.id);
  const products = useQueries({ queries: warehouses.map(warehouse => ({
    queryKey: [...productListQueryPrefix(auth.profile?.id), "all-view", new URL(frontendEnv.supabaseUrl).origin, auth.session?.user.id, warehouse.id, search],
    queryFn: ({ signal }: { signal: AbortSignal }) => listCompleteWarehouseProducts(warehouse.id, search, auth.session!.access_token, signal),
    enabled: active, retry: false, staleTime: 0, refetchOnMount: "always" as const,
  })) });
  const rawCommitments = useInventoryCommitments(rawPlanning, "raw_materials");
  const fgCommitments = useInventoryCommitments(allowed(1), "finished_goods");
  const rawTests = useInventoryTestCommitments(INVENTORY_WAREHOUSES[0]!.id, search, rawPlanning, testsEnabled);
  const fgTests = useInventoryTestCommitments(INVENTORY_WAREHOUSES[1]!.id, search, allowed(1), testsEnabled);
  const customsTests = useInventoryTestCommitments(INVENTORY_WAREHOUSES[2]!.id, search, allowed(2), testsEnabled);
  const rawHealth = useInventoryStockHealth(INVENTORY_WAREHOUSES[0]!.id, search, null, allowed(0));
  const fgHealth = useInventoryStockHealth(INVENTORY_WAREHOUSES[1]!.id, search, null, allowed(1));
  const customsHealth = useInventoryStockHealth(INVENTORY_WAREHOUSES[2]!.id, search, null, allowed(2));
  const tests = [rawTests, fgTests, customsTests], health = [rawHealth, fgHealth, customsHealth];
  const commitments = [rawCommitments, fgCommitments];
  const pending = products.some(q => q.isPending || q.isFetching);
  const failure = products.find(q => q.isError || q.data?.ok === false);
  const rows = pending || failure ? [] : warehouses.flatMap((warehouse, i) => {
    const data = products[i]?.data;
    return data?.ok ? data.value.map((product: ProductListItem) => {
      const index = INVENTORY_WAREHOUSES.findIndex(w => w.id === warehouse.id);
      const cq = commitments[index];
      return { warehouse, product,
        commitment: (index === 0 ? rawPlanning : index === 1) && !cq?.isFetching && !cq?.isError && cq?.data?.ok ? cq.data.value.find(c => c.productId === product.id) : undefined,
        test: tests[index]?.rows?.find(t => t.productId === product.id),
        health: health[index]?.rows?.find(h => h.productId === product.id) };
    }) : [];
  });
  const refresh = async () => {
    await Promise.all([...products.map(q => q.refetch()),
      ...(rawPlanning ? [rawCommitments.refetch()] : []), ...(allowed(1) ? [fgCommitments.refetch()] : []),
      ...tests.filter(t => t.allowed).map(t => t.query.refetch({ cancelRefetch: false })),
      ...health.filter(h => h.allowed).map(h => h.query.refetch({ cancelRefetch: false }))]);
  };
  return { rows, pending, active, failure: failure?.data?.ok === false ? failure.data.error.message : failure ? "The complete Inventory list could not be loaded." : null,
    healthReady: !isInventoryStockHealthEnabled() || warehouses.every(w => health[INVENTORY_WAREHOUSES.findIndex(x => x.id === w.id)]?.rows !== undefined) && rows.every(row => row.health !== undefined), refresh };
}
export type AllInventoryRow = ReturnType<typeof useAllInventory>["rows"][number];
