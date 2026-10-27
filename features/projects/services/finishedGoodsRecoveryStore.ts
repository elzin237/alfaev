import { frontendEnv } from "../../../lib/config/env";
import { isProjectId } from "./projectService";
import { SQL_BIGINT_MAX, type ReservationRequest } from "./projectFinishedGoodsMutationService";

export interface RecoveryIdentity { authUserId: string; profileId: string; projectId: string }
export type RecoveryState = "prepared" | "uncertain" | "confirmed_success" | "definite_failure";
export interface RecoveryRecord {
  schema: 1;
  backend: string;
  identity: RecoveryIdentity;
  createdAt: string;
  updatedAt: string;
  state: RecoveryState;
  request: { operation: ReservationRequest["operation"]; requestId: string; projectId: string; productId: string;
    reservationId: string | null; quantity: string; expectedVersion: string };
}
export class RecoveryStorageError extends Error {
  constructor() { super("Recovery storage cannot be verified. New operations are blocked. Do not clear browser data; ask an Admin to reconcile the original request history, then restore access to this browser's recovery storage."); }
}
export class RecoveryBusyError extends Error {
  constructor() { super("Another tab is processing this Project's request. Wait, then reload recovery status; do not submit a replacement operation."); }
}
const backend = new URL(frontendEnv.supabaseUrl).origin;
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function identityValid(value: unknown): value is RecoveryIdentity {
  return exact(value, ["authUserId", "profileId", "projectId"]) &&
    [value.authUserId, value.profileId, value.projectId].every(v => typeof v === "string" && isProjectId(v));
}
function uint(value: unknown): value is string {
  return typeof value === "string" && value.length <= 19 && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= SQL_BIGINT_MAX;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function recoveryKey(identity: RecoveryIdentity): string {
  if (!identityValid(identity)) throw new RecoveryStorageError();
  return `alfaev:fg-recovery:v1:${encodeURIComponent(backend)}:${identity.authUserId}:${identity.profileId}:${identity.projectId}`;
}
export function parseRecoveryRecord(raw: string, identity: RecoveryIdentity): RecoveryRecord {
  try {
    if (raw.length > 4096) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (!exact(value, ["schema", "backend", "identity", "createdAt", "updatedAt", "state", "request"]) || value.schema !== 1 ||
      value.backend !== backend || !identityValid(value.identity) || recoveryKey(value.identity) !== recoveryKey(identity) ||
      !timestamp(value.createdAt) || !timestamp(value.updatedAt) || value.updatedAt < value.createdAt ||
      !["prepared", "uncertain", "confirmed_success", "definite_failure"].includes(value.state as string) ||
      !exact(value.request, ["operation", "requestId", "projectId", "productId", "reservationId", "quantity", "expectedVersion"])) throw new Error();
    const request = value.request;
    if (!["reserve", "release", "fulfill"].includes(request.operation as string) ||
      ![request.requestId, request.projectId, request.productId].every(v => typeof v === "string" && isProjectId(v)) ||
      request.projectId !== identity.projectId || !uint(request.quantity) || BigInt(request.quantity) <= 0n ||
      !uint(request.expectedVersion) ||
      (request.reservationId === null ? request.expectedVersion !== "0" || request.operation !== "reserve"
        : typeof request.reservationId !== "string" || !isProjectId(request.reservationId) || BigInt(request.expectedVersion) < 1n)) throw new Error();
    return value as unknown as RecoveryRecord;
  } catch { throw new RecoveryStorageError(); }
}
export function readRecovery(identity: RecoveryIdentity): RecoveryRecord | null {
  try {
    if (!navigator.locks?.request) throw new Error();
    if (window.localStorage.getItem(`${recoveryKey(identity)}:requirement`) !== null) throw new Error();
    const raw = window.localStorage.getItem(recoveryKey(identity));
    return raw === null ? null : parseRecoveryRecord(raw, identity);
  } catch { throw new RecoveryStorageError(); }
}
export function restoredRequest(record: RecoveryRecord): Readonly<ReservationRequest> {
  return Object.freeze({ ...record.request, quantity: BigInt(record.request.quantity), expectedVersion: BigInt(record.request.expectedVersion) });
}
export function requestMatchesRecovery(record: RecoveryRecord, request: ReservationRequest): boolean {
  const saved = record.request;
  return saved.operation === request.operation && saved.requestId === request.requestId && saved.projectId === request.projectId &&
    saved.productId === request.productId && saved.reservationId === request.reservationId &&
    saved.quantity === request.quantity.toString() && saved.expectedVersion === request.expectedVersion.toString();
}
function immutable(record: RecoveryRecord): string {
  return JSON.stringify([record.backend, record.identity, record.createdAt, record.request]);
}
export function sameRecoveryRequest(a: RecoveryRecord, b: RecoveryRecord): boolean { return immutable(a) === immutable(b); }
// All writes/removals are performed inside withRecoveryLock. Storage is an
// untrusted intent journal, never an authorization flag or success/stock cache.
export function prepareRecovery(identity: RecoveryIdentity, request: ReservationRequest): RecoveryRecord {
  if (readRecovery(identity)) throw new RecoveryStorageError();
  const now = new Date().toISOString();
  const record: RecoveryRecord = { schema: 1, backend, identity: { ...identity }, createdAt: now, updatedAt: now,
    state: "prepared", request: { ...request, quantity: request.quantity.toString(), expectedVersion: request.expectedVersion.toString() } };
  return write(record);
}
function write(record: RecoveryRecord): RecoveryRecord {
  try {
    const raw = JSON.stringify(record), key = recoveryKey(record.identity);
    const checked = parseRecoveryRecord(raw, record.identity);
    window.localStorage.setItem(key, raw);
    if (window.localStorage.getItem(key) !== raw) throw new Error();
    return checked;
  } catch { throw new RecoveryStorageError(); }
}
export function updateRecovery(record: RecoveryRecord, state: RecoveryState): RecoveryRecord {
  const current = readRecovery(record.identity);
  if (!current || !sameRecoveryRequest(record, current)) throw new RecoveryStorageError();
  return write({ ...current, state, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString() });
}
export function clearRecovery(record: RecoveryRecord): void {
  const current = readRecovery(record.identity);
  if (!current || !sameRecoveryRequest(record, current)) throw new RecoveryStorageError();
  try {
    window.localStorage.removeItem(recoveryKey(record.identity));
    if (window.localStorage.getItem(recoveryKey(record.identity)) !== null) throw new Error();
  } catch { throw new RecoveryStorageError(); }
}
export async function withRecoveryLock<T>(identity: RecoveryIdentity, operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new RecoveryStorageError();
  return navigator.locks.request(recoveryKey(identity), { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new RecoveryBusyError();
    return operation();
  });
}
