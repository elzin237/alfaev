import { frontendEnv } from "../../../lib/config/env";
import { testRecoveryKey, withTestRecoveryLock, type TestRecoveryIdentity } from "./testCalculationRecoveryStore";
import { parseTestImportReceipt, validTestImportRequest, type TestImportReceipt, type TestImportRequest } from "./testCalculationImportService";

// Same durable localStorage/read-back/Web Locks protocol as Test Save. Separate namespace preserves Save journals.
export { withTestRecoveryLock as withTestImportRecoveryLock };
export interface TestImportRecovery {
  schema: 1; backend: string; identity: TestRecoveryIdentity; createdAt: string; canonicalRequest: string;
  request: TestImportRequest; state: "prepared" | "uncertain" | "confirmed_success"; receipt: TestImportReceipt | null;
}
const backend = new URL(frontendEnv.supabaseUrl).origin;
export class TestImportRecoveryError extends Error {
  constructor() { super("Import recovery storage cannot be verified. Keep browser data and recover only the original request."); }
}
export const testImportRecoveryKey = (identity: TestRecoveryIdentity) => testRecoveryKey(identity).replace("test-calculation-recovery:", "test-calculation-import-recovery:");
const canonical = (identity: TestRecoveryIdentity, request: TestImportRequest) => JSON.stringify([
  backend, identity.authUserId, identity.profileId, request.requestId, request.calculationId, request.serialNumber, true,
]);
export function parseTestImportRecovery(raw: string, identity: TestRecoveryIdentity): TestImportRecovery {
  try {
    if (raw.length > 131072) throw Error();
    const r = JSON.parse(raw) as TestImportRecovery;
    if (!r || Object.keys(r).sort().join() !== "backend,canonicalRequest,createdAt,identity,receipt,request,schema,state" || r.schema !== 1 || r.backend !== backend ||
      !r.identity || Object.keys(r.identity).sort().join() !== "authUserId,profileId" || testImportRecoveryKey(r.identity) !== testImportRecoveryKey(identity) ||
      !validTestImportRequest(r.request) || r.canonicalRequest !== canonical(identity, r.request) ||
      typeof r.createdAt !== "string" || !Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString() !== r.createdAt ||
      !["prepared", "uncertain", "confirmed_success"].includes(r.state) ||
      (r.state === "confirmed_success" ? !parseTestImportReceipt(r.receipt, r.request) : r.receipt !== null)) throw Error();
    return r;
  } catch { throw new TestImportRecoveryError(); }
}
export function readTestImportRecovery(identity: TestRecoveryIdentity): TestImportRecovery | null {
  try {
    if (!navigator.locks?.request) throw Error();
    const raw = localStorage.getItem(testImportRecoveryKey(identity));
    return raw === null ? null : parseTestImportRecovery(raw, identity);
  } catch { throw new TestImportRecoveryError(); }
}
export const sameTestImportRecovery = (a: TestImportRecovery, b: TestImportRecovery) =>
  a.canonicalRequest === b.canonicalRequest && a.createdAt === b.createdAt;
function write(record: TestImportRecovery) {
  try {
    const raw = JSON.stringify(record), checked = parseTestImportRecovery(raw, record.identity);
    localStorage.setItem(testImportRecoveryKey(record.identity), raw);
    if (localStorage.getItem(testImportRecoveryKey(record.identity)) !== raw) throw Error();
    return checked;
  } catch { throw new TestImportRecoveryError(); }
}
export function prepareTestImportRecovery(identity: TestRecoveryIdentity, request: TestImportRequest) {
  if (readTestImportRecovery(identity)) throw new TestImportRecoveryError();
  return write({ schema: 1, backend, identity: { ...identity }, request: { ...request }, createdAt: new Date().toISOString(),
    canonicalRequest: canonical(identity, request), state: "prepared", receipt: null });
}
function matching(record: TestImportRecovery) {
  const current = readTestImportRecovery(record.identity);
  if (!current || !sameTestImportRecovery(current, record)) throw new TestImportRecoveryError();
  return current;
}
export function updateTestImportRecovery(record: TestImportRecovery, receipt: TestImportReceipt | null = null) {
  return write({ ...matching(record), state: receipt ? "confirmed_success" : "uncertain", receipt });
}
export function clearTestImportRecovery(record: TestImportRecovery) {
  matching(record);
  try {
    localStorage.removeItem(testImportRecoveryKey(record.identity));
    if (localStorage.getItem(testImportRecoveryKey(record.identity)) !== null) throw Error();
  } catch { throw new TestImportRecoveryError(); }
}
