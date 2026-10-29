import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { frontendEnv } from "../../../lib/config/env";
import { supabase } from "../../../lib/supabase/client";
import { INVENTORY_WAREHOUSES } from "../../inventory/inventoryWarehouses";
import { productListQueryPrefix } from "../../inventory/productQueryKeys";
import type { DashboardInventoryProduct } from "../services/dashboardService";

const raw = INVENTORY_WAREHOUSES[0]!;
const uuid = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

/** Verify the bounded legacy candidates against canonical Raw membership, not Product kind. */
export function useDashboardRawCatalog(candidates: readonly DashboardInventoryProduct[]) {
  const auth = useAuth();
  const identity = Boolean(!auth.isLoading && !auth.error && auth.isActive && auth.profile?.isActive &&
    auth.session?.access_token && auth.profile.authUserId === auth.session.user.id);
  const permission = useQuery({
    queryKey: permissionQueryKey(auth.session?.user.id, auth.profile?.id, raw.viewPermission),
    queryFn: () => hasPermission(raw.viewPermission), enabled: identity && !auth.isAdmin, staleTime: 30_000,
  });
  const allowed = identity && (auth.isAdmin || permission.data?.ok === true && permission.data.value);
  const query = useQuery({
    queryKey: [...productListQueryPrefix(auth.profile?.id), "dashboard-raw-catalog",
      new URL(frontendEnv.supabaseUrl).origin, auth.session?.user.id, candidates],
    enabled: allowed, retry: false, staleTime: 0,
    refetchOnWindowFocus: true, refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      if (!allowed || candidates.length > 5 || candidates.some(p => !uuid(p.productId)) ||
        new Set(candidates.map(p => p.productId)).size !== candidates.length) throw new Error("Catalog unavailable");
      if (candidates.length === 0) return [];
      // Filter at the existing authorized RPC boundary: one request, at most five rows.
      const { data, error } = await supabase.rpc("search_inventory_products_by_warehouse", {
        p_warehouse_id: raw.id, p_search: null,
      }).select("id,warehouse_id,serial_number,name,category,is_active,quantity::text")
        .in("id", candidates.map(p => p.productId)).limit(5)
        .setHeader("Authorization", `Bearer ${auth.session!.access_token}`).abortSignal(signal);
      if (error || !Array.isArray(data) || data.length > candidates.length) throw new Error("Catalog unavailable");
      const rows = new Map<string, DashboardInventoryProduct>();
      const seen = new Set<string>();
      for (const row of data) {
        const original = candidates.find(p => p.productId === row?.id);
        if (!original || seen.has(row.id) || row.warehouse_id !== raw.id || typeof row.is_active !== "boolean" ||
          typeof row.name !== "string" || typeof row.serial_number !== "string" || typeof row.category !== "string" ||
          typeof row.quantity !== "string" || !/^(0|[1-9][0-9]*)$/.test(row.quantity) ||
          BigInt(row.quantity) > 9223372036854775807n) throw new Error("Catalog unavailable");
        seen.add(row.id);
        if (row.is_active) rows.set(row.id, { ...original, name: row.name, serialNumber: row.serial_number,
          category: row.category, quantity: row.quantity });
      }
      return candidates.flatMap(p => rows.has(p.productId) ? [rows.get(p.productId)!] : []);
    },
  });
  const pending = auth.isLoading || identity && !auth.isAdmin && permission.isPending;
  const denied = !pending && !allowed && !permission.isError && permission.data?.ok !== false;
  const products = allowed && !query.isFetching && !query.isError ? query.data : undefined;
  return { products, query, status: denied ? "denied" : permission.isError || permission.data?.ok === false || query.isError
    ? "error" : products ? "ready" : "loading" } as const;
}
