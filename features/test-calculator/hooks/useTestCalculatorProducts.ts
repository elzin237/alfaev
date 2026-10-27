import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { searchTestCalculatorProducts, type TestProductSearchResult } from "../services/testCalculatorSearchService";

// Explicit opt-in is for a later reviewed activation, never an ambient/env fallback.
// The current route remains closed; merely mounting the editor cannot issue a read.
export function useTestCalculatorProducts(search: string, enabledAfterActivation = false) {
  const { session, profile, isActive, isLoading, error } = useAuth();
  const term = search.trim(), [debounced, setDebounced] = useState("");
  const canSearch = enabledAfterActivation && !isLoading && !error && isActive && Boolean(
    session && profile?.isActive && profile.authUserId === session.user.id && profile.id,
  ) && term.length > 0 && term.length <= 200;
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(canSearch ? term : ""), 200);
    return () => window.clearTimeout(timer);
  }, [term, canSearch]);
  const isSettled = canSearch && term === debounced;
  const query = useQuery({
    queryKey: ["test-calculator-products", session?.user.id, profile?.id, debounced],
    queryFn: (): Promise<TestProductSearchResult> => isSettled
      ? searchTestCalculatorProducts(debounced)
      : Promise.resolve({ ok: false, error: { code: "search_failed", message: "Test Product search is not enabled." } }),
    enabled: isSettled, retry: false, staleTime: 0,
  });
  return { ...query, data: isSettled ? query.data : undefined,
    isSearchEnabled: canSearch, isSearchSettling: canSearch && !isSettled };
}
