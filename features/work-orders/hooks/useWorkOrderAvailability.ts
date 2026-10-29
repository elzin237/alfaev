import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { isWorkOrderAvailabilityEnabled } from "../../../app/config/workOrderAvailabilityActivation";
import { frontendEnv } from "../../../lib/config/env";
import { availabilityFailure, availabilityTimestamp, getWorkOrderAvailability } from "../services/workOrderAvailabilityService";

export const workOrderAvailabilityPrefix = (actor: string | undefined, profile: string | undefined) =>
  ["work-order-material-availability", new URL(frontendEnv.supabaseUrl).origin, actor, profile] as const;

export function useWorkOrderAvailability(id: string, version: string, revision: string, unsaved: boolean) {
  const { session, profile, isAdmin, isLoading, error } = useAuth();
  const client = useQueryClient();
  const active = isWorkOrderAvailabilityEnabled() && !isLoading && !error && Boolean(session?.access_token &&
    profile?.isActive && profile.authUserId === session.user.id);
  const permission = useQuery({
    queryKey: permissionQueryKey(session?.user.id, profile?.id, "work_orders.view"),
    queryFn: () => active ? hasPermission("work_orders.view") : Promise.resolve({ ok: true as const, value: false }),
    enabled: active && !isAdmin, staleTime: 0, retry: false,
  });
  const checkingAccess = active && !isAdmin && permission.isPending;
  const allowed = active && (isAdmin || (permission.isFetchedAfterMount && !permission.isFetching &&
    !permission.isError && permission.data?.ok === true && permission.data.value));
  const prefix = workOrderAvailabilityPrefix(session?.user.id, profile?.id);
  const query = useQuery({
    queryKey: [...prefix, id, version, revision],
    queryFn: ({ signal }) => allowed && !unsaved ? getWorkOrderAvailability(id, session!.access_token, signal) : Promise.resolve(availabilityFailure(true)),
    enabled: allowed && !unsaved, retry: false, staleTime: 0,
    refetchOnMount: "always", refetchOnWindowFocus: "always", refetchOnReconnect: "always",
  });
  useEffect(() => {
    if (!allowed || unsaved) return;
    const focused = () => { if (!document.hidden) void query.refetch({ cancelRefetch: false }); };
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [allowed, unsaved, query.refetch]);
  useEffect(() => {
    if (!allowed) return;
    let live = true, queued = false;
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || event.action.type !== "invalidate") return;
      const key = event.query.queryKey;
      const relevant = (key[0] === "inventory" && (key[1] === "products" || key[1] === "commitments" ? key[2] === profile?.id :
        key[1] === "balances" && key[3] === profile?.id)) ||
        (key[0] === "inventory-test-commitments" && key[2] === session?.user.id && key[3] === profile?.id) ||
        (key[0] === "pcb" && key[1] === "production-source" && key[2] === profile?.id);
      if (!relevant || queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (live) void client.invalidateQueries({ queryKey: prefix }); });
    });
    return () => { live = false; unsubscribe(); };
  }, [allowed, client, session?.user.id, profile?.id]);
  const value = allowed && !unsaved && query.isFetchedAfterMount && !query.isFetching && !query.isError && query.data?.ok &&
    availabilityTimestamp(query.data.value.updatedAt) === availabilityTimestamp(version) ? query.data.value : undefined;
  return { allowed, checkingAccess, query, value };
}
