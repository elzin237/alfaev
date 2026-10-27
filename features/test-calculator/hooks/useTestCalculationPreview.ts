import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { previewTestCalculation, type TestPreviewResult } from "../services/testCalculationPreviewService";
import { validateTestCalculationDraft, type TestCalculationDraft } from "../testCalculationDraft";

export function useTestCalculationPreview(draft: TestCalculationDraft, enabledAfterActivation = false) {
  const { session, profile, isActive, isLoading, error } = useAuth();
  const client = useQueryClient();
  const allowed = enabledAfterActivation && !isLoading && !error && isActive && Boolean(
    session && profile?.id && profile.isActive && profile.authUserId === session.user.id,
  );
  const fingerprint = JSON.stringify(draft);
  const key = JSON.stringify([session?.user.id,profile?.id,allowed,fingerprint]);
  const version = useRef(0), inFlight = useRef(false), mounted = useRef(true);
  const currentKey = useRef(key);
  if (currentKey.current !== key) { currentKey.current = key; version.current++; }
  const [busy,setBusy] = useState(false);
  const [state,setState] = useState<{ key: string; attempt: number; result: TestPreviewResult } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
  const invalidate = () => { version.current++; setState(null); };
  const prove = async () => {
    if (inFlight.current) return;
    setState(null);
    if (!allowed || validateTestCalculationDraft(draft).length > 0) {
      setState({ key, attempt: version.current, result: { ok: false, error: { code: "access_denied", message: "Test preview is not enabled or your draft/access could not be verified." } } }); return;
    }
    const attempt = ++version.current, attemptKey = key;
    inFlight.current = true; setBusy(true);
    const payload = draft.items.map(item => ({ product_id: item.product.productId, quantity: item.quantity }));
    try {
      const result = await client.fetchQuery({
        queryKey: ["test-calculation-preview",session!.user.id,profile!.id,fingerprint,attempt],
        queryFn: () => previewTestCalculation(payload), staleTime: 0, gcTime: 0, retry: false,
      });
      if (mounted.current && version.current === attempt && currentKey.current === attemptKey) setState({ key: attemptKey, attempt, result });
    } catch {
      if (mounted.current && version.current === attempt && currentKey.current === attemptKey) setState({ key: attemptKey, attempt,
        result: { ok: false, error: { code: "preview_failed", message: "Test preview could not be loaded. Try proving again." } } });
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const result = state?.key === key && state.attempt === version.current ? state.result : null;
  return { prove, invalidate, isPending: busy, preview: allowed && result?.ok ? result.value : null,
    draftFingerprint: allowed && result?.ok ? fingerprint : null,
    error: result?.ok === false ? result.error.message : null };
}
