import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../../lib/supabase/client", () => ({ supabase: {} }));
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { importIdentity as identity, importRequest, importReceipt, importId } from "../../../test/testCalculationImportFixtures";
import { prepareTestImportRecovery, readTestImportRecovery, parseTestImportRecovery, updateTestImportRecovery, clearTestImportRecovery, testImportRecoveryKey, withTestImportRecoveryLock } from "./testCalculationImportRecoveryStore";
import { prepareTestRecovery, readTestRecovery, withTestRecoveryLock } from "./testCalculationRecoveryStore";
beforeEach(() => installRecoveryBrowser());
it("persists exact canonical intent and isolates backend/actor/profile", () => {
  const r = prepareTestImportRecovery(identity, importRequest);
  expect(readTestImportRecovery(identity)).toEqual(r); expect(r.canonicalRequest).toContain("007");
  expect(readTestImportRecovery({ ...identity, profileId: importId(20) })).toBeNull();
  for (const change of [{ backend: "https://other.supabase.co" }, { identity: { ...identity, authUserId: importId(20) } }, { request: { ...importRequest, serialNumber: "008" } }]) {
    expect(() => parseTestImportRecovery(JSON.stringify({ ...r, ...change }), identity)).toThrow(/storage/);
  }
});
it("retains uncertainty and a validated receipt across reload, clearing only matching intent", () => {
  const r = prepareTestImportRecovery(identity, importRequest); updateTestImportRecovery(r);
  expect(readTestImportRecovery(identity)?.state).toBe("uncertain"); updateTestImportRecovery(r, importReceipt());
  expect(readTestImportRecovery(identity)?.receipt).toEqual(importReceipt());
  expect(() => clearTestImportRecovery({ ...r, canonicalRequest: "changed" })).toThrow();
  clearTestImportRecovery(r); expect(readTestImportRecovery(identity)).toBeNull();
});
it("cannot overwrite pending intent, corrupt storage or an unsafe receipt", () => {
  const r = prepareTestImportRecovery(identity, importRequest);
  expect(() => prepareTestImportRecovery(identity, { ...importRequest, requestId: importId(99) })).toThrow();
  expect(() => updateTestImportRecovery(r, { ...importReceipt(), serial_number: "008" })).toThrow();
  localStorage.setItem(testImportRecoveryKey(identity), "corrupt"); expect(() => readTestImportRecovery(identity)).toThrow();
});
it("preserves Test Save journal bytes and reuses the same exclusive recovery lock", async () => {
  prepareTestRecovery(identity, { requestId: importId(30), name: "Original Save", deadlineDate: "2090-01-01", items: [{ product_id: importId(31), quantity: "1" }] });
  const save = readTestRecovery(identity); prepareTestImportRecovery(identity, importRequest);
  expect(readTestRecovery(identity)).toEqual(save);
  await withTestRecoveryLock(identity, async () => { await expect(withTestImportRecoveryLock(identity, async () => undefined)).rejects.toThrow(/Another tab/); });
});
