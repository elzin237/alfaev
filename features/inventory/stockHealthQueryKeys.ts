import { frontendEnv } from "../../lib/config/env";
import type { QueryClient } from "@tanstack/react-query";
import { isInventoryStockHealthEnabled } from "../../app/config/inventoryStockHealthActivation";
export const stockHealthPrefix = (actor: string | undefined, profile: string | undefined) =>
  ["inventory-stock-health", new URL(frontendEnv.supabaseUrl).origin, actor, profile] as const;
export const dashboardStockHealthPrefix = (actor: string | undefined, profile: string | undefined) =>
  ["dashboard-stock-health", new URL(frontendEnv.supabaseUrl).origin, actor, profile] as const;
export async function invalidatePhysicalStockHealth(client: QueryClient,profileId: string|undefined){
  if(!profileId||!isInventoryStockHealthEnabled())return;
  await client.invalidateQueries({predicate:query=>
    (query.queryKey[0]==="inventory-stock-health"||query.queryKey[0]==="dashboard-stock-health")&&query.queryKey[3]===profileId});
}
