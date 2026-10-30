import {frontendEnv} from "../../../lib/config/env";
import {testRecoveryKey,withTestRecoveryLock,type TestRecoveryIdentity} from "../../test-calculator/services/testCalculationRecoveryStore";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
import {availabilityTimestamp} from "../../work-orders/services/workOrderAvailabilityService";
import type {AttributionRequest,AttributionReceipt} from "./unifiedCommittedService";
export {withTestRecoveryLock as withAttributionRecoveryLock};
export interface AttributionIntent {workOrderId:string;productId:string;classification:"coverage"|"independent"|"unknown";request:AttributionRequest}
export interface AttributionRecovery {schema:1;backend:string;identity:TestRecoveryIdentity;createdAt:string;canonicalRequest:string;
  intent:AttributionIntent;state:"prepared"|"uncertain"|"confirmed_success";receipt:AttributionReceipt|null}
const backend=new URL(frontendEnv.supabaseUrl).origin;
export class AttributionRecoveryError extends Error {constructor(){super("Attribution recovery storage cannot be verified. Keep browser data and recover only the original request.");}}
export const attributionRecoveryKey=(identity:TestRecoveryIdentity)=>testRecoveryKey(identity).replace("test-calculation-recovery:","material-attribution-recovery:");
const canonical=(identity:TestRecoveryIdentity,intent:AttributionIntent)=>JSON.stringify([backend,identity.authUserId,identity.profileId,intent.workOrderId,intent.productId,intent.classification,
  intent.request.requestId,intent.request.kind,intent.request.stateId,intent.request.materialVersion,intent.request.quantity,intent.request.supersedesRequestId??null,intent.request.requirementId??null,intent.request.requirementUpdatedAt??null,intent.request.warehouseId??null]);
const exact=(x:unknown,keys:string):x is Record<string,unknown>=>Boolean(x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).sort().join()===keys.split(",").sort().join());
export function validAttributionIntent(x:unknown):x is AttributionIntent {
  if(!exact(x,"workOrderId,productId,classification,request")||!testUuid(x.workOrderId)||!testUuid(x.productId)||!["coverage","independent","unknown"].includes(x.classification as string)||!x.request||typeof x.request!=="object")return false;
  const r=x.request as AttributionRequest;
  if(Object.keys(r).some(k=>!["requestId","kind","stateId","materialVersion","quantity","supersedesRequestId","requirementId","requirementUpdatedAt","warehouseId"].includes(k))||!testUuid(r.requestId)||!testUuid(r.stateId)||!["coverage","independent"].includes(r.kind)||typeof r.materialVersion!=="string"||!/^[1-9][0-9]{0,18}$/.test(r.materialVersion)||typeof r.quantity!=="string"||!/^(0|[1-9][0-9]{0,18})$/.test(r.quantity)||BigInt(r.materialVersion)>9223372036854775807n||BigInt(r.quantity)>9223372036854775807n||r.supersedesRequestId!=null&&!testUuid(r.supersedesRequestId))return false;
  if(x.classification!=="unknown"&&x.classification!==r.kind)return false;
  return r.kind==="coverage"?testUuid(r.requirementId)&&availabilityTimestamp(r.requirementUpdatedAt)!==null&&testUuid(r.warehouseId):r.requirementId==null&&r.requirementUpdatedAt==null&&r.warehouseId==null;
}
export function parseAttributionRecovery(raw:string,identity:TestRecoveryIdentity):AttributionRecovery{
  try{if(raw.length>32768)throw Error();const r=JSON.parse(raw) as AttributionRecovery;
    if(!exact(r,"schema,backend,identity,createdAt,canonicalRequest,intent,state,receipt")||r.schema!==1||r.backend!==backend||!exact(r.identity,"authUserId,profileId")||attributionRecoveryKey(r.identity)!==attributionRecoveryKey(identity)||!validAttributionIntent(r.intent)||r.canonicalRequest!==canonical(identity,r.intent)||typeof r.createdAt!=="string"||!Number.isFinite(Date.parse(r.createdAt))||new Date(r.createdAt).toISOString()!==r.createdAt||!["prepared","uncertain","confirmed_success"].includes(r.state))throw Error();
    if(r.state==="confirmed_success"?(!exact(r.receipt,"schema,request_id,kind,state_id")||r.receipt.schema!==1||r.receipt.request_id!==r.intent.request.requestId||r.receipt.kind!==r.intent.request.kind||r.receipt.state_id!==r.intent.request.stateId):r.receipt!==null)throw Error();return r;
  }catch{throw new AttributionRecoveryError();}
}
export function readAttributionRecovery(identity:TestRecoveryIdentity){try{if(!navigator.locks?.request)throw Error();const raw=localStorage.getItem(attributionRecoveryKey(identity));return raw===null?null:parseAttributionRecovery(raw,identity);}catch{throw new AttributionRecoveryError();}}
export const sameAttributionRecovery=(a:AttributionRecovery,b:AttributionRecovery)=>a.canonicalRequest===b.canonicalRequest&&a.createdAt===b.createdAt;
function write(r:AttributionRecovery){try{const raw=JSON.stringify(r),checked=parseAttributionRecovery(raw,r.identity);localStorage.setItem(attributionRecoveryKey(r.identity),raw);if(localStorage.getItem(attributionRecoveryKey(r.identity))!==raw)throw Error();return checked;}catch{throw new AttributionRecoveryError();}}
export function prepareAttributionRecovery(identity:TestRecoveryIdentity,intent:AttributionIntent){if(readAttributionRecovery(identity))throw new AttributionRecoveryError();return write({schema:1,backend,identity:{...identity},intent:JSON.parse(JSON.stringify(intent)) as AttributionIntent,createdAt:new Date().toISOString(),canonicalRequest:canonical(identity,intent),state:"prepared",receipt:null});}
function matching(r:AttributionRecovery){const current=readAttributionRecovery(r.identity);if(!current||!sameAttributionRecovery(current,r))throw new AttributionRecoveryError();return current;}
export function updateAttributionRecovery(r:AttributionRecovery,receipt:AttributionReceipt|null=null){return write({...matching(r),state:receipt?"confirmed_success":"uncertain",receipt});}
export function clearAttributionRecovery(r:AttributionRecovery){matching(r);try{localStorage.removeItem(attributionRecoveryKey(r.identity));if(localStorage.getItem(attributionRecoveryKey(r.identity))!==null)throw Error();}catch{throw new AttributionRecoveryError();}}
