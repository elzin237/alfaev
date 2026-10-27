import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), mutate: vi.fn(), eligible: vi.fn(), refresh: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../services/projectFinishedGoodsService", () => ({ getProjectFinishedGoods: mocks.refresh }));
vi.mock("../services/projectFinishedGoodsMutationService", async original => ({
  ...await original<typeof import("../services/projectFinishedGoodsMutationService")>(),
  reserveFinishedGoods: mocks.mutate, releaseFinishedGoods: mocks.mutate, fulfillFinishedGoods: mocks.mutate, getFinishedGoodsActiveState: mocks.eligible,
}));
import { maximumReservationChange, useProjectFinishedGoodsMutations } from "./useProjectFinishedGoodsMutations";
import type { ProjectFinishedGoods } from "../services/projectFinishedGoodsService";
import type { ProjectStatus } from "../projectStatus";
import { projectFinishedGoodsQueryKeys } from "../projectFinishedGoodsQueryKeys";
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { prepareRecovery, readRecovery, recoveryKey, updateRecovery } from "../services/finishedGoodsRecoveryStore";
const projectId = "00000000-0000-4000-8000-000000000001";
const row: ProjectFinishedGoods = { productId: "00000000-0000-4000-8000-000000000002", productName: "Calculator", serialNumber: "007",
  plannedRequirement: 10n, actualProjectConsumption: 0n, outstandingDemand: 10n, physicalQuantity: 10n,
  globallyReservedQuantity: 3n, availableQuantity: 7n, projectReservedQuantity: 3n,
  reservationId: "00000000-0000-4000-8000-000000000003", reservationVersion: 5n };
const profileId = "00000000-0000-4000-8000-000000000100";
const otherProfileId = "00000000-0000-4000-8000-000000000101";
const authUserId = "00000000-0000-4000-8000-000000000200";
const otherAuthUserId = "00000000-0000-4000-8000-000000000201";
const auth = (id = profileId, admin = true) => ({ session: { access_token: "test-token", user: { id: id === profileId ? authUserId : otherAuthUserId } }, profile: { id, isActive: true }, isAdmin: admin });
const success = { ok: true, value: { reservationId: row.reservationId, reservedQuantity: 0n, reservationVersion: 1n } };
const uncertain = { ok: false, error: { code: "outcome_uncertain", message: "Uncertain outcome", uncertain: true } };
const identity = { authUserId, profileId, projectId };
function setup(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>;
  return { client, ...renderHook(({ project, status, canRead }) => useProjectFinishedGoodsMutations(project, status, canRead), {
    wrapper, initialProps: { project: projectId, status: "planned" as ProjectStatus, canRead: true },
  }) };
}
beforeEach(() => { vi.resetAllMocks(); installRecoveryBrowser(); mocks.auth.mockReturnValue(auth()); mocks.permission.mockResolvedValue({ ok: true, value: true });
  mocks.refresh.mockResolvedValue({ ok: true, value: [] });
  mocks.eligible.mockResolvedValue(true); mocks.mutate.mockResolvedValue(success); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Finished Goods mutation state machine", () => {
  it.each(["reserve", "release", "fulfill"] as const)("%s refetches the active profile's nested FG warehouse aggregate", async operation => {
    const { result, client } = setup();
    const key=["inventory","commitments",profileId,"warehouse","finished_goods"];
    const foreign=["inventory","commitments",otherProfileId,"warehouse","finished_goods"];
    client.setQueryData(foreign,{ physical:99n });
    const read=vi.fn().mockResolvedValueOnce({ physical:10n,committed:3n }).mockResolvedValue({ physical:8n,committed:1n });
    const observer=new QueryObserver(client,{queryKey:key,queryFn:read,staleTime:Infinity});
    const stop=observer.subscribe(()=>{});
    await waitFor(()=>expect(read).toHaveBeenCalledOnce());
    await act(async()=>{await result.current.open(row,operation);});
    act(()=>result.current.setQuantity("1")); await act(async()=>{await result.current.submit();});
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));
    expect(client.getQueryData(key)).toEqual({physical:8n,committed:1n});
    expect(client.getQueryData(foreign)).toEqual({physical:99n});
    expect(client.getQueryState(foreign)?.isInvalidated).toBe(false);stop();
  });
  it("calculates delta bounds, including fulfillment/release with globally available zero", () => {
    expect(maximumReservationChange(row, "reserve")).toBe(7n);
    expect(maximumReservationChange({ ...row, outstandingDemand: 4n }, "reserve")).toBe(1n);
    for (const operation of ["release", "fulfill"] as const)
      expect(maximumReservationChange({ ...row, availableQuantity: 0n }, operation)).toBe(3n);
  });
  it.each(["projects.view", "projects.edit", "inventory.finished_goods.view", "inventory.finished_goods.reserve"])("requires %s for non-Admins", async missing => {
    mocks.auth.mockReturnValue(auth(otherProfileId, false)); mocks.permission.mockImplementation(async key => ({ ok: true, value: key !== missing }));
    const { result } = setup(); await waitFor(() => expect(mocks.permission).toHaveBeenCalledTimes(4));
    expect(result.current.authorized).toBe(false);
    await act(async () => { await result.current.open(row, "reserve"); }); expect(result.current.selection).toBeNull();
  });
  it("allows all four grants, but not permission errors, inactive Admin or missing read access", async () => {
    mocks.auth.mockReturnValue(auth(otherProfileId, false)); const { result, rerender } = setup();
    await waitFor(() => expect(result.current.authorized).toBe(true));
    rerender({ project: projectId, status: "planned", canRead: false }); expect(result.current.authorized).toBe(false);
    mocks.auth.mockReturnValue({ ...auth(), profile: { id: profileId, isActive: false } });
    rerender({ project: projectId, status: "planned", canRead: true }); expect(result.current.authorized).toBe(false);
  });
  it.each(["completed", "cancelled"] as const)("does not start a new operation on %s", async status => {
    const { result, rerender } = setup(); rerender({ project: projectId, status, canRead: true });
    expect(result.current.canStart).toBe(false); await act(async () => { await result.current.open(row, "fulfill"); });
    expect(result.current.selection).toBeNull(); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each(["reserve", "fulfill"] as const)("blocks %s for archived or unverifiable Products", async operation => {
    mocks.eligible.mockResolvedValue(false); const { result } = setup();
    await act(async () => { await result.current.open(row, operation); result.current.setQuantity("1"); });
    await act(async () => { await result.current.submit(); }); expect(mocks.mutate).not.toHaveBeenCalled();
    expect(result.current.error).toContain("archived");
  });
  it("allows release without an active-Product read or available stock", async () => {
    const { result } = setup();
    await act(async () => { await result.current.open({ ...row, availableQuantity: 0n }, "release"); });
    act(() => result.current.setQuantity("3")); await act(async () => { await result.current.submit(); });
    expect(mocks.eligible).not.toHaveBeenCalled(); expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: "release", quantity: 3n }), "test-token");
  });
  it.each([[null, 0n], [row.reservationId, 9n]] as const)("uses exact retained identity/version %s %s", async (reservationId, reservationVersion) => {
    const { result } = setup(); await act(async () => { await result.current.open({ ...row, projectReservedQuantity: 0n, reservationId, reservationVersion }, "reserve"); });
    act(() => result.current.setQuantity("2")); await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ reservationId, expectedVersion: reservationVersion, quantity: 2n }), "test-token");
  });
  it("five rapid submissions create one UUID/RPC and confirmed completion cannot resubmit", async () => {
    let resolve!: (value: unknown) => void; mocks.mutate.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = setup(); await act(async () => { await result.current.open(row, "reserve"); });
    act(() => result.current.setQuantity("2"));
    act(() => { for (let i = 0; i < 5; i++) void result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce(); const captured = mocks.mutate.mock.calls[0]![0]; expect(Object.isFrozen(captured)).toBe(true);
    await act(async () => { resolve(success); }); await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });
  it("a stale submit callback cannot reopen the successful-completion window", async () => {
    const { result } = setup(); await act(async () => { await result.current.open(row, "release"); });
    act(() => result.current.setQuantity("1"));
    const originalSubmit = result.current.submit;
    await act(async () => { await originalSubmit(); await originalSubmit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });
  it("retains immutable UUID/payload after ambiguous outcome, blocks cancel/edit and exactly retries", async () => {
    mocks.mutate.mockResolvedValueOnce(uncertain).mockResolvedValueOnce(success);
    const { result } = setup(); await act(async () => { await result.current.open(row, "reserve"); });
    act(() => result.current.setQuantity("2")); await act(async () => { await result.current.submit(); });
    const captured = mocks.mutate.mock.calls[0]![0];
    act(() => { result.current.close(); result.current.setQuantity("7"); });
    expect(result.current.selection).not.toBeNull(); expect(result.current.quantity).toBe("2");
    await act(async () => { await result.current.submit(); }); expect(mocks.mutate.mock.calls[1]![0]).toBe(captured);
    expect(result.current.outcome?.ok).toBe(true);
  });
  it("preserves an uncertain request across section unmount/remount in the same app session", async () => {
    mocks.mutate.mockResolvedValue(uncertain); const first = setup();
    await act(async () => { await first.result.current.open(row, "reserve"); });
    act(() => first.result.current.setQuantity("2")); await act(async () => { await first.result.current.submit(); });
    const original = mocks.mutate.mock.calls[0]![0]; first.unmount();
    const second = setup(first.client); await waitFor(() => expect(second.result.current.uncertain).toBe(true));
    await act(async () => { await second.result.current.submit(); }); expect(mocks.mutate.mock.calls[1]![0]).toEqual(original);
  });
  it("refreshes profile-scoped stock/planning/history without inserting historical receipt quantities", async () => {
    const { result, client } = setup(); const spy = vi.spyOn(client, "invalidateQueries");
    const key = projectFinishedGoodsQueryKeys.context(profileId, projectId); client.setQueryData(key, { authoritative: "not a receipt" });
    await act(async () => { await result.current.open(row, "fulfill"); }); act(() => result.current.setQuantity("1"));
    await act(async () => { await result.current.submit(); });
    const keys = spy.mock.calls.map(([arg]) => arg?.queryKey);
    expect(keys).toContainEqual(projectFinishedGoodsQueryKeys.profile(profileId));
    expect(keys).toContainEqual(["projects", "planning", profileId, projectId]);
    expect(keys).toContainEqual(["inventory", "movements", "product", profileId]);
    expect(client.getQueryData(key)).toEqual({ ok: true, value: [] });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(keys.flat()).not.toContain(otherProfileId);
  });
  it("refetches active authoritative context rather than replacing it with a historical retry receipt", async () => {
    const { result, client } = setup();
    mocks.refresh.mockResolvedValue({ ok: true, value: [{ ...row, physicalQuantity: 8n, projectReservedQuantity: 1n }] });
    const read = vi.fn().mockResolvedValueOnce({ physical: 10n, own: 3n }).mockResolvedValue({ physical: 8n, own: 1n });
    const key = projectFinishedGoodsQueryKeys.context(profileId, projectId);
    const observer = new QueryObserver(client, { queryKey: key, queryFn: read, staleTime: Infinity });
    const stop = observer.subscribe(() => {});
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ physical: 10n, own: 3n }));
    await act(async () => { await result.current.open(row, "fulfill"); }); act(() => result.current.setQuantity("2"));
    await act(async () => { await result.current.submit(); });
    expect(read).toHaveBeenCalledTimes(2); expect(client.getQueryData(key)).toEqual({ ok: true, value: [{ ...row, physicalQuantity: 8n, projectReservedQuantity: 1n }] });
    stop();
  });
  it("preserves exact retry after Project closure without allowing a new operation", async () => {
    mocks.mutate.mockResolvedValueOnce(uncertain).mockResolvedValueOnce(success);
    const { result, rerender } = setup(); await act(async () => { await result.current.open(row, "fulfill"); });
    act(() => result.current.setQuantity("2")); await act(async () => { await result.current.submit(); });
    const original = mocks.mutate.mock.calls[0]![0];
    rerender({ project: projectId, status: "cancelled", canRead: true });
    expect(result.current.canStart).toBe(false); await act(async () => { await result.current.submit(); });
    expect(mocks.mutate.mock.calls[1]![0]).toBe(original);
  });
  it("durably retains uncertainty instead of relying on a browser unload warning", async () => {
    mocks.mutate.mockResolvedValueOnce(uncertain).mockResolvedValueOnce(success);
    const { result } = setup(); await act(async () => { await result.current.open(row, "release"); });
    act(() => result.current.setQuantity("1")); await act(async () => { await result.current.submit(); });
    expect(localStorage.length).toBe(1);
    const saved = JSON.parse(localStorage.getItem(localStorage.key(0)!)!); expect(saved.state).toBe("uncertain");
    await act(async () => { await result.current.submit(); });
    const after = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
    expect(localStorage.length).toBe(0);
  });
  it("stale rejection refetches but requires close/new explicit decision; never auto-updates request version", async () => {
    mocks.mutate.mockResolvedValue({ ok: false, error: { code: "FGR04", uncertain: false, message: "Review current state" } });
    const { result, client } = setup(); const spy = vi.spyOn(client, "invalidateQueries");
    await act(async () => { await result.current.open(row, "reserve"); }); act(() => result.current.setQuantity("2"));
    await act(async () => { await result.current.submit(); }); await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(spy).toHaveBeenCalled();
    act(() => result.current.close()); expect(result.current.selection).toBeNull();
  });
  it.each(["profile", "project"])("late completion does not update/invalidate the changed %s context", async changed => {
    let resolve!: (value: unknown) => void; mocks.mutate.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result, rerender, client } = setup(); const spy = vi.spyOn(client, "invalidateQueries");
    await act(async () => { await result.current.open(row, "reserve"); }); act(() => result.current.setQuantity("2"));
    act(() => { void result.current.submit(); });
    if (changed === "profile") mocks.auth.mockReturnValue(auth(otherProfileId));
    rerender({ project: changed === "project" ? row.productId : projectId, status: "planned", canRead: true });
    await act(async () => { resolve(success); }); expect(result.current.selection).toBeNull(); expect(spy).not.toHaveBeenCalled();
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });
  it("rejects invalid/over-bound quantities locally", async () => {
    const { result } = setup(); await act(async () => { await result.current.open(row, "reserve"); });
    for (const text of ["0", "1.5", "8", "9223372036854775808"]) {
      act(() => result.current.setQuantity(text)); await act(async () => { await result.current.submit(); });
    }
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("persists before dispatch and clears only after a new authorized backend read", async () => {
    mocks.mutate.mockImplementation(async captured => {
      const saved = readRecovery(identity)!;
      expect(saved.state).toBe("prepared"); expect(saved.request.requestId).toBe(captured.requestId);
      expect(saved.request.quantity).toBe("2");
      expect(JSON.stringify(saved)).not.toContain("test-token"); return success;
    });
    mocks.refresh.mockImplementation(async () => {
      expect(readRecovery(identity)?.state).toBe("confirmed_success"); return { ok: true, value: [] };
    });
    const { result } = setup(); await act(async () => { await result.current.open(row, "release"); });
    act(() => result.current.setQuantity("2")); await act(async () => { await result.current.submit(); });
    expect(readRecovery(identity)).toBeNull(); expect(result.current.reconciled).toBe(true);
  });
  it("recovers a page/browser restart during dispatch with a new QueryClient and no automatic RPC", async () => {
    mocks.mutate.mockReturnValueOnce(new Promise(() => {})); const first = setup();
    await act(async () => { await first.result.current.open(row, "fulfill"); }); act(() => first.result.current.setQuantity("2"));
    act(() => { void first.result.current.submit(); });
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
    const captured = mocks.mutate.mock.calls[0]![0]; expect(readRecovery(identity)?.state).toBe("prepared");
    first.unmount(); first.client.clear(); installRecoveryBrowser(false); // New process/locks, same durable browser data.
    const second = setup(); await waitFor(() => expect(second.result.current.recovered).toBe(true));
    expect(second.result.current.request).toEqual(captured); expect(second.result.current.outcome).toBeNull();
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(second.result.current.canStart).toBe(false);
    await act(async () => { await second.result.current.submit(); });
    expect(mocks.mutate.mock.calls[1]![0]).toEqual(captured); expect(second.result.current.reconciled).toBe(true);
  });
  it.each(["prepared", "uncertain", "confirmed_success", "definite_failure"] as const)("never trusts a restored %s label as proof or replays automatically", async state => {
    const original = { operation: "reserve" as const, projectId, productId: row.productId, quantity: 9223372036854775807n,
      reservationId: row.reservationId, expectedVersion: 9007199254740993n, requestId: "00000000-0000-4000-8000-000000000400" };
    const saved = prepareRecovery(identity, original); updateRecovery(saved, state);
    const { result } = setup(); await waitFor(() => expect(result.current.recovered).toBe(true));
    expect(result.current.outcome).toBeNull(); expect(result.current.request).toEqual(original); expect(mocks.mutate).not.toHaveBeenCalled();
    await act(async () => { await result.current.submit(); }); expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(original, "test-token");
  });
  it("retries after backend-commit/timeout without a second physical effect", async () => {
    const committed = new Set<string>(); let effects = 0;
    mocks.mutate.mockImplementation(async captured => {
      if (committed.has(captured.requestId)) return success;
      committed.add(captured.requestId); effects++; return uncertain;
    });
    const first = setup(); await act(async () => { await first.result.current.open(row, "fulfill"); });
    act(() => first.result.current.setQuantity("2")); await act(async () => { await first.result.current.submit(); });
    const original = first.result.current.request; first.unmount(); first.client.clear();
    const next = setup(); await waitFor(() => expect(next.result.current.recovered).toBe(true));
    await act(async () => { await next.result.current.submit(); });
    expect(next.result.current.request).toEqual(original); expect(effects).toBe(1); expect(localStorage.length).toBe(0);
  });
  it("retains confirmed success after failed reconciliation and retries only the read", async () => {
    mocks.refresh.mockResolvedValueOnce({ ok: false, error: { code: "load_failed" } }).mockResolvedValueOnce({ ok: true, value: [] });
    const { result } = setup(); await act(async () => { await result.current.open(row, "release"); });
    act(() => result.current.setQuantity("1")); await act(async () => { await result.current.submit(); });
    expect(readRecovery(identity)?.state).toBe("confirmed_success"); expect(result.current.reconciled).toBe(false);
    act(() => result.current.close()); expect(result.current.selection).not.toBeNull();
    expect(result.current.retryRefreshOnly).toBe(true);
    await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledTimes(2); expect(localStorage.length).toBe(0);
  });
  it.each(["42501", "FGR01", "PGRST202", "42883"])("does not erase prior uncertainty after %s denial", async code => {
    mocks.mutate.mockResolvedValueOnce(uncertain).mockResolvedValueOnce({ ok: false, error: { code, uncertain: false, message: "Denied" } });
    const { result } = setup(); await act(async () => { await result.current.open(row, "reserve"); });
    act(() => result.current.setQuantity("2")); await act(async () => { await result.current.submit(); });
    const original = result.current.request; await act(async () => { await result.current.submit(); });
    expect(result.current.request).toBe(original); expect(result.current.reconciled).toBe(false);
    expect(readRecovery(identity)?.state).toBe("definite_failure"); expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => result.current.close()); expect(result.current.selection).not.toBeNull();
  });
  it("fails closed on corrupt storage without overwriting it or generating a request", async () => {
    localStorage.setItem(recoveryKey(identity), "{broken"); const uuid = vi.spyOn(crypto, "randomUUID");
    const { result } = setup(); expect(result.current.canStart).toBe(false); expect(result.current.recoveryIssue).toContain("Do not clear");
    await act(async () => { await result.current.open(row, "release"); await result.current.submit(); });
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled(); expect(localStorage.getItem(recoveryKey(identity))).toBe("{broken");
  });
  it("does not dispatch if persistence fails and retains the captured UUID for an explicit safe retry", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const uuid = vi.spyOn(crypto, "randomUUID"); const { result } = setup();
    await act(async () => { await result.current.open(row, "release"); }); act(() => result.current.setQuantity("1"));
    await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(result.current.recoveryIssue).not.toBeNull();
    const original = result.current.request; set.mockRestore(); act(() => result.current.checkRecovery());
    await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(original, "test-token"); expect(uuid).toHaveBeenCalledOnce();
  });
  it("cannot pair a failed-write in-memory UUID with a different durable record", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = setup(); await act(async () => { await result.current.open(row, "release"); });
    act(() => result.current.setQuantity("1")); await act(async () => { await result.current.submit(); });
    const original = result.current.request!; set.mockRestore();
    prepareRecovery(identity, { ...original, requestId: "00000000-0000-4000-8000-000000000500" });
    act(() => result.current.checkRecovery()); await act(async () => { await result.current.submit(); });
    expect(result.current.recoveryIssue).not.toBeNull(); expect(mocks.mutate).not.toHaveBeenCalled();
    expect(result.current.request?.requestId).toBe(original.requestId);
  });
  it("detects changed persisted payloads before retrying and blocks conflicting new operations", async () => {
    mocks.mutate.mockResolvedValue(uncertain); const { result } = setup();
    await act(async () => { await result.current.open(row, "release"); }); act(() => result.current.setQuantity("2"));
    await act(async () => { await result.current.submit(); });
    const saved = readRecovery(identity)!; localStorage.setItem(recoveryKey(identity), JSON.stringify({ ...saved, request: { ...saved.request, quantity: "1" } }));
    await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(result.current.recoveryIssue).not.toBeNull(); expect(result.current.canStart).toBe(false);
  });
  it("keeps original-account recovery through sign-out/cache clearing and never replays for a different account", async () => {
    mocks.mutate.mockResolvedValue(uncertain); const first = setup();
    await act(async () => { await first.result.current.open(row, "reserve"); }); act(() => first.result.current.setQuantity("2"));
    await act(async () => { await first.result.current.submit(); }); const original = first.result.current.request;
    first.unmount(); first.client.clear(); mocks.auth.mockReturnValue(auth(otherProfileId));
    const other = setup(); expect(other.result.current.selection).toBeNull(); expect(other.result.current.request).toBeNull();
    expect(other.result.current.canStart).toBe(true); expect(mocks.mutate).toHaveBeenCalledOnce(); expect(readRecovery(identity)).not.toBeNull();
    other.unmount(); mocks.auth.mockReturnValue(auth()); const restored = setup();
    await waitFor(() => expect(restored.result.current.recovered).toBe(true)); expect(restored.result.current.request).toEqual(original);
  });
  it("one tab cannot dispatch while another owns the Project's recovery lock", async () => {
    let finish!: (value: unknown) => void; mocks.mutate.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = setup(); await act(async () => { await first.result.current.open(row, "release"); }); act(() => first.result.current.setQuantity("1"));
    act(() => { void first.result.current.submit(); }); await waitFor(() => expect(mocks.mutate).toHaveBeenCalledOnce());
    const second = setup(); await waitFor(() => expect(second.result.current.recovered).toBe(true));
    await act(async () => { await second.result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(second.result.current.error).toContain("Another tab");
    await act(async () => { finish(success); });
  });
  it("a competing draft adopts the original durable request instead of dispatching its different quantity", async () => {
    mocks.mutate.mockResolvedValueOnce(uncertain).mockResolvedValueOnce(success);
    const first = setup(), second = setup();
    await act(async () => { await first.result.current.open(row, "reserve"); await second.result.current.open(row, "reserve"); });
    act(() => { first.result.current.setQuantity("2"); second.result.current.setQuantity("3"); });
    await act(async () => { await first.result.current.submit(); });
    const original = first.result.current.request;
    await act(async () => { await second.result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(second.result.current.request).toEqual(original);
    expect(second.result.current.recovered).toBe(true); expect(second.result.current.quantity).toBe("2");
    await act(async () => { await second.result.current.submit(); });
    expect(mocks.mutate.mock.calls[1]![0]).toEqual(original);
  });
  it("keeps recovery intact when current view or mutation authorization is revoked", async () => {
    mocks.mutate.mockResolvedValue(uncertain); const { result, rerender } = setup();
    await act(async () => { await result.current.open(row, "reserve"); }); act(() => result.current.setQuantity("2"));
    await act(async () => { await result.current.submit(); });
    const saved = localStorage.getItem(recoveryKey(identity));
    rerender({ project: projectId, status: "planned", canRead: false });
    expect(result.current.selection).toBeNull(); expect(result.current.request).toBeNull();
    await act(async () => { await result.current.submit(); });
    expect(mocks.mutate).toHaveBeenCalledOnce(); expect(localStorage.getItem(recoveryKey(identity))).toBe(saved);
  });
  it("bounds reconciliation, retains the receipt, and ignores a late read after timeout", async () => {
    let finish!: (value: unknown) => void;
    mocks.refresh.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { result, client } = setup(); await act(async () => { await result.current.open(row, "release"); });
    act(() => result.current.setQuantity("1")); vi.useFakeTimers();
    try {
      let pending!: Promise<void>;
      act(() => { pending = result.current.submit(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await pending; });
      expect(result.current.busy).toBe(false); expect(result.current.retryRefreshOnly).toBe(true);
      expect(readRecovery(identity)?.state).toBe("confirmed_success");
      await act(async () => { finish({ ok: true, value: [row] }); });
      expect(client.getQueryData(projectFinishedGoodsQueryKeys.context(profileId, projectId))).toBeUndefined();
      expect(localStorage.length).toBe(1); expect(mocks.mutate).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
