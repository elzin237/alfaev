import { frontendEnv } from "../../../lib/config/env";
import { validTestSaveRequest, testUuid, type TestSaveRequest } from "./testCalculationSaveService";
export interface TestRecoveryIdentity { authUserId:string;profileId:string }
export interface TestRecoveryRecord { schema:1;backend:string;identity:TestRecoveryIdentity;createdAt:string;state:"prepared"|"uncertain"|"confirmed_success"|"definite_failure";request:TestSaveRequest }
const backend=new URL(frontendEnv.supabaseUrl).origin;
export class TestRecoveryError extends Error { constructor(){super("Test recovery storage cannot be verified. New Saves are blocked. Do not clear browser data; request authorized reconciliation of the original request.");} }
const exact=(v:unknown,keys:string):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.split(",").sort().join());
export function testRecoveryKey(identity:TestRecoveryIdentity){if(!testUuid(identity.authUserId)||!testUuid(identity.profileId))throw new TestRecoveryError();return `alfaev:test-calculation-recovery:v1:${encodeURIComponent(backend)}:${identity.authUserId}:${identity.profileId}`;}
export function parseTestRecovery(raw:string,identity:TestRecoveryIdentity):TestRecoveryRecord{
  try{if(raw.length>65536)throw Error();const r:unknown=JSON.parse(raw);
    if(!exact(r,"schema,backend,identity,createdAt,state,request")||r.schema!==1||r.backend!==backend||!exact(r.identity,"authUserId,profileId")||
      !testUuid(r.identity.authUserId)||!testUuid(r.identity.profileId)||testRecoveryKey(r.identity as unknown as TestRecoveryIdentity)!==testRecoveryKey(identity)||
      typeof r.createdAt!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.createdAt)||!Number.isFinite(Date.parse(r.createdAt))||new Date(r.createdAt).toISOString()!==r.createdAt||
      !["prepared","uncertain","confirmed_success","definite_failure"].includes(r.state as string)||!validTestSaveRequest(r.request))throw Error();
    return r as unknown as TestRecoveryRecord;
  }catch{throw new TestRecoveryError();}
}
export function readTestRecovery(identity:TestRecoveryIdentity):TestRecoveryRecord|null{
  try{if(!navigator.locks?.request)throw Error();const raw=localStorage.getItem(testRecoveryKey(identity));return raw===null?null:parseTestRecovery(raw,identity);}catch{throw new TestRecoveryError();}
}
const immutable=(r:TestRecoveryRecord)=>JSON.stringify([r.schema,r.backend,r.identity,r.createdAt,r.request]);
export const sameTestRecovery=(a:TestRecoveryRecord,b:TestRecoveryRecord)=>immutable(a)===immutable(b);
function write(r:TestRecoveryRecord){try{const raw=JSON.stringify(r),checked=parseTestRecovery(raw,r.identity);localStorage.setItem(testRecoveryKey(r.identity),raw);if(localStorage.getItem(testRecoveryKey(r.identity))!==raw)throw Error();return checked;}catch{throw new TestRecoveryError();}}
export function prepareTestRecovery(identity:TestRecoveryIdentity,request:TestSaveRequest){if(readTestRecovery(identity))throw new TestRecoveryError();return write({schema:1,backend,identity:{...identity},createdAt:new Date().toISOString(),state:"prepared",request:JSON.parse(JSON.stringify(request)) as TestSaveRequest});}
export function updateTestRecovery(r:TestRecoveryRecord,state:TestRecoveryRecord["state"]){const current=readTestRecovery(r.identity);if(!current||!sameTestRecovery(current,r))throw new TestRecoveryError();return write({...current,state});}
export function clearTestRecovery(r:TestRecoveryRecord){const current=readTestRecovery(r.identity);if(!current||!sameTestRecovery(current,r))throw new TestRecoveryError();try{localStorage.removeItem(testRecoveryKey(r.identity));if(localStorage.getItem(testRecoveryKey(r.identity))!==null)throw Error();}catch{throw new TestRecoveryError();}}
export async function withTestRecoveryLock<T>(identity:TestRecoveryIdentity,work:()=>Promise<T>){if(!navigator.locks?.request)throw new TestRecoveryError();return navigator.locks.request(testRecoveryKey(identity),{mode:"exclusive",ifAvailable:true},async lock=>{if(!lock)throw new Error("Another tab is processing this Test Save. Wait and recover its original request.");return work();});}
export const testCalculationHistoryPrefix=(identity:TestRecoveryIdentity)=>["test-calculation-history",backend,identity.authUserId,identity.profileId] as const;
export const inventoryTestCommitmentsPrefix=(identity:TestRecoveryIdentity)=>["inventory-test-commitments",backend,identity.authUserId,identity.profileId] as const;
