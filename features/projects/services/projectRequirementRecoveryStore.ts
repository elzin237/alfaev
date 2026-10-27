import { frontendEnv } from "../../../lib/config/env";
import { recoveryKey, RecoveryStorageError, type RecoveryIdentity } from "./finishedGoodsRecoveryStore";
import { validRequirementRequest, type RequirementRequest } from "./projectRequirementMutationService";

export interface RequirementRecovery {
  schema: 1; backend: string; identity: RecoveryIdentity; createdAt: string; state: "pending";
  request: Readonly<RequirementRequest>;
}
const backend=new URL(frontendEnv.supabaseUrl).origin;
export const requirementRecoveryKey=(identity:RecoveryIdentity)=>`${recoveryKey(identity)}:requirement`;
export function parseRequirementRecovery(raw:string,identity:RecoveryIdentity):RequirementRecovery {
  try {
    if(raw.length>8192)throw Error();const value=JSON.parse(raw) as RequirementRecovery;
    if(!value || Object.keys(value).sort().join()!==["schema","backend","identity","createdAt","state","request"].sort().join() ||
      value.schema!==1 || value.state!=="pending" || value.backend!==backend || !value.identity ||
      Object.keys(value.identity).sort().join()!==["authUserId","profileId","projectId"].sort().join() ||
      recoveryKey(value.identity)!==recoveryKey(identity) || !validRequirementRequest(value.request) || value.request.projectId!==identity.projectId ||
      typeof value.createdAt!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt) ||
      !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString()!==value.createdAt)throw Error();
    return {...value,request:Object.freeze({...value.request})};
  }catch{throw new RecoveryStorageError();}
}
export function readRequirementRecovery(identity:RecoveryIdentity):RequirementRecovery|null {
  try {
    if(!navigator.locks?.request || window.localStorage.getItem(recoveryKey(identity))!==null)throw Error();
    const raw=window.localStorage.getItem(requirementRecoveryKey(identity));
    return raw===null?null:parseRequirementRecovery(raw,identity);
  }catch{throw new RecoveryStorageError();}
}
export function prepareRequirementRecovery(identity:RecoveryIdentity,request:RequirementRequest):RequirementRecovery {
  try {
    if(readRequirementRecovery(identity))throw Error();
    const record:RequirementRecovery={schema:1,backend,identity:{...identity},createdAt:new Date().toISOString(),state:"pending",request:{...request}};
    const raw=JSON.stringify(record),checked=parseRequirementRecovery(raw,identity);
    window.localStorage.setItem(requirementRecoveryKey(identity),raw);
    if(window.localStorage.getItem(requirementRecoveryKey(identity))!==raw)throw Error();return checked;
  }catch{throw new RecoveryStorageError();}
}
export function clearRequirementRecovery(record:RequirementRecovery):void {
  try {
    const current=readRequirementRecovery(record.identity);
    if(!current || JSON.stringify(current)!==JSON.stringify(record))throw Error();
    window.localStorage.removeItem(requirementRecoveryKey(record.identity));
    if(window.localStorage.getItem(requirementRecoveryKey(record.identity))!==null)throw Error();
  }catch{throw new RecoveryStorageError();}
}
