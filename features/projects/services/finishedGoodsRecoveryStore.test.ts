import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../lib/config/env", () => ({ frontendEnv: { supabaseUrl: "https://recovery-test.invalid" } }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: {} }));
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { clearRecovery, prepareRecovery, readRecovery, recoveryKey, restoredRequest, updateRecovery, withRecoveryLock,
  parseRecoveryRecord, sameRecoveryRequest, RecoveryStorageError, RecoveryBusyError } from "./finishedGoodsRecoveryStore";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const identity = { authUserId: id(1), profileId: id(2), projectId: id(3) };
const request = { operation: "reserve" as const, projectId: id(3), productId: id(4), quantity: 9223372036854775807n,
  expectedVersion: 9007199254740993n, requestId: id(5), reservationId: id(6) };
beforeEach(() => { vi.restoreAllMocks(); installRecoveryBrowser(); });
describe("durable Finished Goods intent journal", () => {
  it("persists only scoped metadata and decimal strings, not tokens, names or stock", () => {
    const saved = prepareRecovery(identity, request);
    const raw = localStorage.getItem(recoveryKey(identity))!;
    expect(saved.state).toBe("prepared"); expect(saved.createdAt).toMatch(/^\d{4}-/);
    expect(JSON.parse(raw).request).toMatchObject({ quantity: "9223372036854775807", expectedVersion: "9007199254740993" });
    expect(raw).not.toMatch(/token|password|productName|physicalQuantity|reservedQuantity/);
    expect(restoredRequest(readRecovery(identity)!)).toEqual(request);
  });
  it.each(["uncertain", "confirmed_success", "definite_failure"] as const)("retains the identical request when recording %s", state => {
    const saved = prepareRecovery(identity, request); const next = updateRecovery(saved, state);
    expect(sameRecoveryRequest(saved, next)).toBe(true); expect(readRecovery(identity)?.state).toBe(state);
  });
  it("does not expire or automatically discard old uncertainty", () => {
    const saved = prepareRecovery(identity, request);
    localStorage.setItem(recoveryKey(identity), JSON.stringify({ ...saved, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" }));
    expect(readRecovery(identity)?.request.requestId).toBe(request.requestId);
  });
  it("isolates Auth user, profile, Project and backend", () => {
    const saved = prepareRecovery(identity, request);
    for (const other of [{ ...identity, authUserId: id(7) }, { ...identity, profileId: id(7) }, { ...identity, projectId: id(7) }]) {
      expect(readRecovery(other)).toBeNull(); expect(() => parseRecoveryRecord(JSON.stringify(saved), other)).toThrow(RecoveryStorageError);
    }
    expect(() => parseRecoveryRecord(JSON.stringify({ ...saved, backend: "https://other.invalid" }), identity)).toThrow(RecoveryStorageError);
  });
  it.each([
    { schema: 2 }, { token: "must not be accepted" }, { state: "resolved" }, { createdAt: "invalid" }, { updatedAt: "2000-01-01T00:00:00.000Z" },
    { request: {} }, { identity: { ...identity, profileId: "other" } },
  ])("rejects corrupted/extended journal schemas %j", patch => {
    const saved = prepareRecovery(identity, request);
    localStorage.setItem(recoveryKey(identity), JSON.stringify({ ...saved, ...patch }));
    expect(() => readRecovery(identity)).toThrow(RecoveryStorageError);
    expect(localStorage.getItem(recoveryKey(identity))).not.toBeNull();
  });
  it.each([
    { quantity: 1 }, { quantity: "0" }, { quantity: "1.5" }, { quantity: "1e3" }, { quantity: "01" }, { quantity: "9223372036854775808" },
    { expectedVersion: -1 }, { expectedVersion: "9223372036854775808" }, { reservationId: null }, { projectId: id(9) },
    { operation: "adjust" }, { requestId: "invalid" }, { extra: "secret" },
  ])("validates the entire immutable request %j", patch => {
    const saved = prepareRecovery(identity, request);
    expect(() => parseRecoveryRecord(JSON.stringify({ ...saved, request: { ...saved.request, ...patch } }), identity)).toThrow(RecoveryStorageError);
  });
  it("supports only Reserve with a missing identity/version zero", () => {
    const saved = prepareRecovery(identity, { ...request, reservationId: null, expectedVersion: 0n });
    expect(restoredRequest(saved).expectedVersion).toBe(0n);
    expect(() => parseRecoveryRecord(JSON.stringify({ ...saved, request: { ...saved.request, operation: "fulfill" } }), identity)).toThrow();
  });
  it("rejects overwrites and conflicting payload changes even with the same UUID", () => {
    const original = prepareRecovery(identity, request);
    expect(() => prepareRecovery(identity, { ...request, requestId: id(9) })).toThrow(RecoveryStorageError);
    localStorage.setItem(recoveryKey(identity), JSON.stringify({ ...original, request: { ...original.request, quantity: "1" } }));
    expect(() => updateRecovery(original, "uncertain")).toThrow(RecoveryStorageError);
    expect(() => clearRecovery(original)).toThrow(RecoveryStorageError);
  });
  it("fails closed for blocked reads, quota errors and silent write loss", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => readRecovery(identity)).toThrow(RecoveryStorageError); get.mockRestore();
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => prepareRecovery(identity, request)).toThrow(RecoveryStorageError); set.mockImplementation(() => {});
    expect(() => prepareRecovery(identity, request)).toThrow(RecoveryStorageError);
  });
  it("requires Web Locks without an unsafe localStorage-only fallback", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(() => readRecovery(identity)).toThrow(RecoveryStorageError);
    await expect(withRecoveryLock(identity, async () => {})).rejects.toThrow(RecoveryStorageError);
  });
  it("serializes dispatch across tabs and never steals a held lock", async () => {
    let release!: () => void;
    const pending = withRecoveryLock(identity, () => new Promise<void>(resolve => { release = resolve; }));
    const second = vi.fn(); await expect(withRecoveryLock(identity, second)).rejects.toThrow(RecoveryBusyError);
    expect(second).not.toHaveBeenCalled(); release(); await pending;
    await withRecoveryLock(identity, async () => { prepareRecovery(identity, request); });
    expect(readRecovery(identity)).not.toBeNull();
  });
  it("does not silently treat deleted/corrupted records as successfully updated or cleared", () => {
    const saved = prepareRecovery(identity, request); localStorage.removeItem(recoveryKey(identity));
    expect(() => updateRecovery(saved, "confirmed_success")).toThrow(); expect(() => clearRecovery(saved)).toThrow();
  });
});
