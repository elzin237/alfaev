import { beforeEach,describe,expect,it,vi } from "vitest";
import { installRecoveryBrowser } from "../../../test/finishedGoodsRecoveryBrowser";
import { prepareRecovery,readRecovery,recoveryKey,withRecoveryLock } from "./finishedGoodsRecoveryStore";
import { clearRequirementRecovery,parseRequirementRecovery,prepareRequirementRecovery,readRequirementRecovery,requirementRecoveryKey } from "./projectRequirementRecoveryStore";
import type { RequirementRequest } from "./projectRequirementMutationService";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const identity={authUserId:id(1),profileId:id(2),projectId:id(3)};
const request:RequirementRequest={requestId:id(4),operation:"create",projectId:id(3),groupId:id(5),componentId:null,productId:id(6),quantity:"9223372036854775807",expectedProductId:null,expectedQuantity:null};
beforeEach(()=>{vi.restoreAllMocks();installRecoveryBrowser();});
describe("requirement intent recovery",()=>{
  it("survives restart as the identical decimal-string payload, scoped to identity/backend",()=>{
    const saved=prepareRequirementRecovery(identity,request);expect(readRequirementRecovery(identity)).toEqual(saved);
    expect(readRequirementRecovery({...identity,profileId:id(8)})).toBeNull();
    expect(()=>parseRequirementRecovery(JSON.stringify(saved),{...identity,authUserId:id(8)})).toThrow();
    expect(localStorage.getItem(requirementRecoveryKey(identity))).not.toMatch(/token|password|secret/);
    clearRequirementRecovery(saved);expect(readRequirementRecovery(identity)).toBeNull();
  });
  it.each([{schema:2},{extra:"unexpected"},{createdAt:"invalid"},{backend:"https://other.invalid"},{request:{...request,quantity:1}}])("rejects corruption without discarding the record %j",patch=>{
    const saved=prepareRequirementRecovery(identity,request);localStorage.setItem(requirementRecoveryKey(identity),JSON.stringify({...saved,...patch}));
    expect(()=>readRequirementRecovery(identity)).toThrow();expect(localStorage.getItem(requirementRecoveryKey(identity))).not.toBeNull();
  });
  it("rejects conflicting operations and blocks manual mutations until requirement reconciliation",()=>{
    prepareRequirementRecovery(identity,request);expect(()=>prepareRequirementRecovery(identity,{...request,requestId:id(9)})).toThrow();expect(()=>readRecovery(identity)).toThrow();
  });
  it("cannot create a requirement intent while a manual reservation is unresolved",()=>{
    prepareRecovery(identity,{operation:"reserve",projectId:id(3),productId:id(6),quantity:1n,expectedVersion:0n,requestId:id(9),reservationId:null});
    expect(()=>prepareRequirementRecovery(identity,request)).toThrow();expect(localStorage.getItem(recoveryKey(identity))).not.toBeNull();
  });
  it("fails closed on unavailable storage and serializes tabs with the existing Web Lock",async()=>{
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("blocked");});expect(()=>prepareRequirementRecovery(identity,request)).toThrow();
    let release!:()=>void;const first=withRecoveryLock(identity,()=>new Promise<void>(resolve=>{release=resolve;}));
    await expect(withRecoveryLock(identity,async()=>undefined)).rejects.toThrow();release();await first;
  });
});
