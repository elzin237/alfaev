import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { isTestCalculationImportEnabled } from "../../../app/config/testCalculationImportActivation";
import { testUuid } from "../services/testCalculationSaveService";
import { importTestCalculation, validImportSerial, type TestImportReceipt } from "../services/testCalculationImportService";
import { clearTestImportRecovery, prepareTestImportRecovery, readTestImportRecovery, sameTestImportRecovery,
  testImportRecoveryKey, TestImportRecoveryError, updateTestImportRecovery, withTestImportRecoveryLock,
  type TestImportRecovery } from "../services/testCalculationImportRecoveryStore";
import { invalidateTestImport } from "../testCalculationImportQueryKeys";

const permissions = ["test_calculator.view", "test_calculator.manage", "pcb.view", "pcb.create", "pcb.edit"] as const;
interface State { scope: string; ready: boolean; pending: TestImportRecovery | null; saved: TestImportReceipt | null; busy: boolean; error: string | null }

// Backend independently enforces source warehouse permissions. Callers must also honor the release gate.
export function useTestCalculationImport() {
  const auth = useAuth(), client = useQueryClient(), enabled = isTestCalculationImportEnabled();
  const active = enabled && !auth.isLoading && !auth.error && auth.isActive && Boolean(auth.session?.access_token &&
    auth.profile?.isActive && auth.profile.authUserId === auth.session.user.id && testUuid(auth.profile.id) && testUuid(auth.session.user.id));
  const grants = useQueries({ queries: permissions.map(permission => ({
    queryKey: permissionQueryKey(auth.session?.user.id, auth.profile?.id, permission),
    queryFn: () => hasPermission(permission), enabled: active && !auth.isAdmin, retry: false, staleTime: 0,
  })) });
  const allowed = active && (auth.isAdmin || grants.every(q => q.isFetchedAfterMount && !q.isFetching && !q.isError && q.data?.ok && q.data.value));
  const identity = useMemo(() => allowed ? { authUserId: auth.session!.user.id, profileId: auth.profile!.id } : null,
    [allowed, auth.session?.user.id, auth.profile?.id]);
  const scope = identity ? testImportRecoveryKey(identity) : "disabled";
  const control = useMemo(() => ({ busy: false, known: null as TestImportRecovery | null }), [scope]);
  const current = useRef({ scope, allowed }); current.current = { scope, allowed };
  const mounted = useRef(true);
  const [state, setState] = useState<State>({ scope: "", ready: false, pending: null, saved: null, busy: false, error: null });
  const inScope = () => mounted.current && current.current.scope === scope && current.current.allowed;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setState({ scope, ready: false, pending: null, saved: null, busy: false, error: null });
    if (!identity) return;
    const check = () => {
      if (!inScope() || control.busy) return;
      try {
        const pending = readTestImportRecovery(identity);
        if (control.known && (!pending || !sameTestImportRecovery(control.known, pending))) throw new TestImportRecoveryError();
        control.known = pending;
        setState(s => ({ ...s, scope, ready: true, pending, error: null }));
      } catch { setState(s => ({ ...s, scope, ready: false, error: new TestImportRecoveryError().message })); }
    };
    check();
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === scope) check(); };
    window.addEventListener("storage", changed); window.addEventListener("focus", check);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", check); };
  }, [scope, control]);
  const visible = allowed && state.scope === scope;
  const canImport = Boolean(visible && state.ready && !state.pending && !state.saved && !state.busy && !control.busy);
  async function execute(input?: { calculationId: string; serialNumber: string }, confirmed = false) {
    const recovering = input === undefined;
    if (!identity || !inScope() || control.busy || !visible || !state.ready || state.saved ||
      (!recovering && (!canImport || !confirmed || !testUuid(input.calculationId) || !validImportSerial(input.serialNumber)))) return;
    control.busy = true; setState(s => ({ ...s, busy: true, error: null }));
    const token = auth.session!.access_token;
    try {
      await withTestImportRecoveryLock(identity, async () => {
        if (!inScope()) return;
        let record = readTestImportRecovery(identity);
        if (control.known && (!record || !sameTestImportRecovery(control.known, record))) throw new TestImportRecoveryError();
        if (record && !recovering) { control.known = record; setState(s => ({ ...s, pending: record })); return; }
        if (!record) {
          if (recovering) throw new TestImportRecoveryError();
          record = prepareTestImportRecovery(identity, { requestId: crypto.randomUUID(), calculationId: input!.calculationId, serialNumber: input!.serialNumber });
        }
        control.known = record;
        if (!inScope()) return;
        let receipt = record.receipt;
        if (!receipt) {
          // Persist uncertainty BEFORE dispatch, so a crash/reload can never imply failure.
          record = updateTestImportRecovery(record); control.known = record;
          setState(s => ({ ...s, pending: record }));
          const result = await importTestCalculation(record.request, token);
          if (!result.ok) {
            // A denial during replay says nothing about an earlier attempt's commit.
            if (!recovering && !result.error.uncertain) { clearTestImportRecovery(record); control.known = null; }
            if (inScope()) setState(s => ({ ...s, pending: control.known, error: recovering ?
              "The original import remains unresolved. This replay was not verified; retain the original request for authorized recovery." : result.error.message }));
            return;
          }
          receipt = result.value;
          record = updateTestImportRecovery(record, receipt); control.known = record;
        }
        if (!inScope()) return;
        setState(s => ({ ...s, pending: record }));
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([invalidateTestImport(client, identity, receipt), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Refresh timeout")), 30_000);
          })]);
        } finally { if (timer !== undefined) clearTimeout(timer); }
        if (!inScope()) return;
        clearTestImportRecovery(record); control.known = null;
        setState(s => ({ ...s, pending: null, saved: receipt, error: null }));
      });
    } catch (cause) {
      if (inScope()) setState(s => ({ ...s, ready: cause instanceof TestImportRecoveryError ? false : s.ready,
        error: cause instanceof TestImportRecoveryError ? cause.message : "Import or refresh could not finish. Recover the original request; do not submit a replacement." }));
    } finally { control.busy = false; if (inScope()) setState(s => ({ ...s, busy: false })); }
  }
  return { authorized: allowed, scope, canImport, submit: (input: { calculationId: string; serialNumber: string }, confirmed: boolean) => execute(input, confirmed),
    recover: () => execute(), pending: visible ? state.pending : null, saved: visible ? state.saved : null,
    busy: visible && state.busy, error: visible ? state.error : null, blocked: !visible || !state.ready };
}
