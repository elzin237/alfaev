import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { testUuid } from "../services/testCalculationSaveService";
import { testCalculationHistoryPrefix } from "../services/testCalculationRecoveryStore";
import { listTestCalculations, type TestHistoryCursor } from "../services/testCalculationHistoryService";

// Existing RPC has no search parameter: search is explicitly current-page only.
export function useTestImportSelection(enabled: boolean) {
  const auth = useAuth();
  const allowed = enabled && !auth.isLoading && !auth.error && auth.isActive && Boolean(auth.session?.access_token &&
    auth.profile?.isActive && auth.profile.authUserId === auth.session.user.id && testUuid(auth.profile.id) && testUuid(auth.session.user.id));
  const identity = allowed ? { authUserId: auth.session!.user.id, profileId: auth.profile!.id } : null;
  const prefix = identity ? testCalculationHistoryPrefix(identity) : ["test-calculation-history", "disabled"];
  const scope = JSON.stringify(prefix);
  const [paging, setPaging] = useState<{ scope: string; cursors: (TestHistoryCursor | null)[] }>({ scope, cursors: [null] });
  const cursors = paging.scope === scope ? paging.cursors : [null], cursor = cursors[cursors.length - 1]!;
  const query = useQuery({ queryKey: [...prefix, "import-selector", 20, cursor],
    queryFn: ({ signal }) => allowed ? listTestCalculations(20, cursor, auth.session!.access_token, signal) :
      Promise.resolve({ ok: false as const, error: { code: "access_denied" as const, message: "History access could not be verified." } }),
    enabled: allowed, retry: false, staleTime: 0,
  });
  const verified = allowed && query.isFetchedAfterMount && !query.isFetching && !query.isError && query.data?.ok;
  return { query, rows: verified && query.data?.ok ? query.data.value.rows : [], page: cursors.length,
    hasPrevious: cursors.length > 1, hasNext: Boolean(verified && query.data?.ok && query.data.value.nextCursor),
    previous: () => { if (!query.isFetching && cursors.length > 1) setPaging({ scope, cursors: cursors.slice(0, -1) }); },
    next: () => { if (verified && query.data?.ok && query.data.value.nextCursor) setPaging({ scope, cursors: [...cursors, query.data.value.nextCursor] }); },
  };
}
