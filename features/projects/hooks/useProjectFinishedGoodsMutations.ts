import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import type { ProjectStatus } from "../projectStatus";
import { getProjectFinishedGoods, type ProjectFinishedGoods } from "../services/projectFinishedGoodsService";
import { projectFinishedGoodsQueryKeys } from "../projectFinishedGoodsQueryKeys";
import { projectPlanningQueryKey } from "../projectPlanningQueryKeys";
import { projectMaterialUsageQueryKey } from "../projectMaterialUsageQueryKeys";
import { productListQueryPrefix } from "../../inventory/productQueryKeys";
import { inventoryCommitmentsQueryKey } from "../../inventory/inventoryCommitmentQueryKeys";
import { dashboardQueryKey } from "../../dashboard/dashboardQueryKeys";
import { projectAlertQueryPrefix } from "../../dashboard/projectAlertQueryKeys";
import {
  fulfillFinishedGoods, releaseFinishedGoods, reserveFinishedGoods, getFinishedGoodsActiveState,
  parseReservationQuantity, SQL_BIGINT_MAX, type ReservationOperation, type ReservationRequest,
  type ReservationMutationResult,
} from "../services/projectFinishedGoodsMutationService";
import {
  readRecovery, prepareRecovery, updateRecovery, clearRecovery, withRecoveryLock, restoredRequest,
  sameRecoveryRequest, requestMatchesRecovery, recoveryKey, RecoveryStorageError, RecoveryBusyError, type RecoveryRecord,
} from "../services/finishedGoodsRecoveryStore";

export function maximumReservationChange(row: ProjectFinishedGoods, operation: ReservationOperation): bigint {
  if (operation !== "reserve") return row.projectReservedQuantity;
  return [row.availableQuantity, row.outstandingDemand - row.projectReservedQuantity, SQL_BIGINT_MAX].reduce((a, b) => a < b ? a : b);
}
type Selection = { row: ProjectFinishedGoods; operation: ReservationOperation; scope: string; recovered?: boolean };
const operations = { reserve: reserveFinishedGoods, release: releaseFinishedGoods, fulfill: fulfillFinishedGoods };
// Access/contract denial or UUID conflict cannot prove an earlier request did not commit.
function conclusive(result: ReservationMutationResult) {
  return result.ok || !result.error.uncertain && !["42501", "FGR01", "PGRST202", "42883", "22023"].includes(result.error.code);
}

export function useProjectFinishedGoodsMutations(projectId: string, status: ProjectStatus, canRead: boolean) {
  const { session, profile, isAdmin } = useAuth();
  const client = useQueryClient();
  const scope = `${session?.user.id ?? ""}/${profile?.id ?? ""}/${projectId}`;
  const identity = useMemo(() => session && profile?.isActive ? {
    authUserId: session.user.id, profileId: profile.id, projectId,
  } : null, [session?.user.id, profile?.id, profile?.isActive, projectId]);
  const active = Boolean(session && profile?.isActive);
  const permissions = useQueries({ queries: (["projects.view", "projects.edit", "inventory.finished_goods.view", "inventory.finished_goods.reserve"] as const)
    .map(key => ({ queryKey: permissionQueryKey(session?.user.id, profile?.id, key), queryFn: () => hasPermission(key),
      enabled: active && canRead && !isAdmin, staleTime: 60_000 })) });
  const authorized = Boolean(canRead && active && (isAdmin || permissions.every(q => !q.isError && q.data?.ok && q.data.value)));
  const current = useRef({ scope, authorized, token: session?.access_token });
  current.current = { scope, authorized, token: session?.access_token };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selected = useRef<Selection | null>(null);
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const record = useRef<RecoveryRecord | null>(null);
  const attempt = useRef<Readonly<ReservationRequest> | null>(null);
  const trustedOutcome = useRef<ReservationMutationResult | null>(null);
  const [outcome, setOutcome] = useState<ReservationMutationResult | null>(null);
  const [reconciled, setReconciled] = useState(false);
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [activeProduct, setActiveProduct] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<{ scope: string; ready: boolean; issue: string | null }>({ scope: "", ready: false, issue: null });
  const openProject = ["planned", "in_progress", "on_hold"].includes(status);
  const inScope = () => mounted.current && current.current.scope === scope;
  const mayExecute = () => inScope() && current.current.authorized && Boolean(current.current.token);

  function recover(saved: RecoveryRecord) {
    if (record.current && !sameRecoveryRequest(record.current, saved)) throw new RecoveryStorageError();
    if (attempt.current && !requestMatchesRecovery(saved, attempt.current)) throw new RecoveryStorageError();
    record.current = saved;
    const newlyRestored = !attempt.current;
    if (newlyRestored) attempt.current = restoredRequest(saved);
    if (newlyRestored || !selected.current || selected.current.operation !== saved.request.operation || selected.current.row.productId !== saved.request.productId) {
      const context = client.getQueryData<Awaited<ReturnType<typeof getProjectFinishedGoods>>>(projectFinishedGoodsQueryKeys.context(saved.identity.profileId, projectId));
      const row = context?.ok ? context.value.find(item => item.productId === saved.request.productId) : undefined;
      const recovered: Selection = { scope, operation: saved.request.operation, recovered: true, row: row ?? {
        productId: saved.request.productId, productName: "Recovered Finished Goods request", serialNumber: "",
        plannedRequirement: 0n, actualProjectConsumption: 0n, outstandingDemand: 0n, physicalQuantity: 0n,
        globallyReservedQuantity: 0n, availableQuantity: 0n, projectReservedQuantity: 0n,
        reservationId: saved.request.reservationId, reservationVersion: BigInt(saved.request.expectedVersion),
      } };
      selected.current = recovered; setSelection(recovered);
    }
    setQuantity(saved.request.quantity);
    // Persisted state is not proof of a receipt. Restart always needs explicit replay.
    setStorage({ scope, ready: true, issue: null });
  }
  function checkRecovery() {
    if (!identity || !inScope()) return;
    try {
      const saved = readRecovery(identity);
      if (!saved && record.current) throw new RecoveryStorageError();
      if (saved) recover(saved);
      else setStorage({ scope, ready: true, issue: null });
    } catch { setStorage({ scope, ready: false, issue: new RecoveryStorageError().message }); }
  }
  useEffect(() => {
    selected.current = null; record.current = null; attempt.current = null; trustedOutcome.current = null;
    lock.current = false; done.current = false;
    setSelection(null); setQuantity(""); setOutcome(null); setError(null); setBusy(false); setReconciled(false);
    setStorage({ scope, ready: false, issue: null });
    if (!identity) return;
    checkRecovery();
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === recoveryKey(identity) || event.key === `${recoveryKey(identity)}:requirement`) checkRecovery();
    };
    window.addEventListener("storage", changed); window.addEventListener("focus", checkRecovery);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", checkRecovery); };
  }, [identity, scope]);
  const storageReady = storage.scope === scope && storage.ready;
  const visible = selection?.scope === scope && active && canRead;
  const canStart = authorized && openProject && storageReady && !selection && !record.current && !lock.current;

  async function open(row: ProjectFinishedGoods, operation: ReservationOperation) {
    if (!inScope() || !canStart || selected.current || lock.current || maximumReservationChange(row, operation) <= 0n) return;
    const next: Selection = { row, operation, scope };
    selected.current = next; setSelection(next); setQuantity(""); setOutcome(null); setError(null); setActiveProduct(null);
    if (operation === "release") return;
    lock.current = true; setBusy(true);
    const eligible = await getFinishedGoodsActiveState(row.productId);
    if (!inScope()) return;
    lock.current = false; setBusy(false); setActiveProduct(eligible);
    if (eligible !== true) setError(eligible === false ? "This Product is archived. Only Release is available."
      : "Product eligibility could not be verified. Close and refresh before trying again.");
  }
  function close() {
    if (!inScope() || lock.current || attempt.current && !done.current) return;
    selected.current = null; attempt.current = null; trustedOutcome.current = null; done.current = false;
    setSelection(null); setQuantity(""); setOutcome(null); setError(null); setReconciled(false);
  }
  async function refresh(saved: RecoveryRecord, accessToken: string) {
    if (!mayExecute()) throw new Error("identity");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const reconcile = async () => {
      const fresh = await getProjectFinishedGoods(projectId, controller.signal, accessToken);
      if (!live || !fresh.ok || !mayExecute()) throw new Error("refresh");
      const id = saved.identity.profileId;
      await Promise.all([
        projectFinishedGoodsQueryKeys.profile(id), productListQueryPrefix(id),
        ["inventory", "products", "detail", id], ["inventory", "balances", "detail", id],
        ["inventory", "movements", "product", id], ["inventory-source-lots", id],
        inventoryCommitmentsQueryKey(id), projectPlanningQueryKey(id, projectId), projectMaterialUsageQueryKey(id, projectId),
        ["pcb", "cards", id], ["pcb", "bom", id], ["pcb", "bom-choices", id], ["pcb", "production-source", id],
        dashboardQueryKey(id), projectAlertQueryPrefix(id),
      ].map(queryKey => client.invalidateQueries({ queryKey })));
      if (!live || !mayExecute()) throw new Error("identity");
      client.setQueryData(projectFinishedGoodsQueryKeys.context(id, projectId), fresh);
    };
    try {
      await Promise.race([reconcile(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("refresh timeout")); }, 30_000);
      })]);
    } finally { live = false; controller.abort(); if (timer !== undefined) clearTimeout(timer); }
  }
  async function submit() {
    if (!identity || !selected.current || !visible || lock.current || done.current || !storageReady || !mayExecute()) return;
    const selectionAtStart = selected.current;
    const token = current.current.token!; // Memory only, never journaled.
    const amount = parseReservationQuantity(quantity);
    if (!attempt.current && (!openProject || selectionAtStart.operation !== "release" && activeProduct !== true)) return;
    if (!attempt.current && (amount === null || amount > maximumReservationChange(selectionAtStart.row, selectionAtStart.operation))) {
      setError("Enter a positive whole quantity no greater than the displayed maximum."); return;
    }
    lock.current = true; setBusy(true); setError(null);
    try {
      await withRecoveryLock(identity, async () => {
        if (!mayExecute()) return;
        const saved = readRecovery(identity);
        if (!attempt.current && saved) { recover(saved); return; } // Another tab won: no UUID or RPC.
        let captured = attempt.current;
        let durable = record.current;
        if (!captured) {
          captured = Object.freeze({ operation: selectionAtStart.operation, projectId, productId: selectionAtStart.row.productId,
            quantity: amount!, expectedVersion: selectionAtStart.row.reservationVersion, reservationId: selectionAtStart.row.reservationId,
            requestId: crypto.randomUUID() });
          attempt.current = captured;
          durable = prepareRecovery(identity, captured); // Persist and read back BEFORE dispatch.
          record.current = durable;
        } else if (!durable && !saved) {
          // A previous persist-before-dispatch failure never reached the RPC.
          // Explicit retry still uses that same captured UUID, not a replacement.
          durable = prepareRecovery(identity, captured); record.current = durable;
        } else if (!durable || !saved || !sameRecoveryRequest(durable, saved)) throw new RecoveryStorageError();
        if (!durable || !mayExecute()) return;
        if (!requestMatchesRecovery(durable, captured)) throw new RecoveryStorageError();
        let result = trustedOutcome.current;
        if (!result || !conclusive(result)) {
          try { result = await operations[captured.operation](captured, token); }
          catch { result = { ok: false, error: { code: "outcome_uncertain", uncertain: true,
            message: "The outcome is uncertain. Retry only the exact original request." } }; }
          durable = updateRecovery(durable, result.ok ? "confirmed_success" : result.error.uncertain ? "uncertain" : "definite_failure");
          if (!inScope()) return;
          record.current = durable; trustedOutcome.current = result; setOutcome(result);
        }
        if (!result || !mayExecute()) return;
        if (!conclusive(result)) { if (!result.ok) setError(result.error.message); return; }
        try {
          await refresh(durable, token);
          if (!mayExecute()) return;
          clearRecovery(durable); // Only after verified result AND fresh authorized state.
          record.current = null; done.current = true; setReconciled(true);
          if (!result.ok) setError(result.error.message);
        } catch (cause) {
          if (cause instanceof RecoveryStorageError) throw cause;
          if (inScope()) setError("The request result is known, but authoritative reconciliation did not finish. Its original request is retained. Retry the refresh, not a replacement operation.");
        }
      });
    } catch (cause) {
      if (inScope()) {
        if (cause instanceof RecoveryBusyError) setError(cause.message);
        else setStorage({ scope, ready: false, issue: new RecoveryStorageError().message });
      }
    } finally { if (inScope()) { lock.current = false; setBusy(false); } }
  }
  return { canStart, authorized, openProject, selection: visible ? selection : null,
    blockedByOtherScope: Boolean(selection && selection.scope !== scope), quantity,
    setQuantity: (value: string) => { if (inScope() && !attempt.current) { setQuantity(value);
      if (selection?.operation === "release" || activeProduct === true) setError(null); } },
    busy, outcome, error, activeProduct, frozen: Boolean(attempt.current), reconciled,
    recovered: selection?.recovered === true, request: visible ? attempt.current : null,
    retryRefreshOnly: Boolean(trustedOutcome.current && conclusive(trustedOutcome.current) && !reconciled),
    uncertain: Boolean(attempt.current && !reconciled), recoveryIssue: storage.scope === scope ? storage.issue : null,
    recoveryPendingWithoutAccess: Boolean(record.current && !authorized), checkRecovery,
    open, close, submit };
}
