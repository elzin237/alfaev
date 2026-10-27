import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("../../../lib/config/env",()=>({frontendEnv:{supabaseUrl:"https://test-recovery.invalid"}}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{}}));
import {installRecoveryBrowser} from "../../../test/finishedGoodsRecoveryBrowser";
import {prepareTestRecovery,readTestRecovery,testRecoveryKey,parseTestRecovery,updateTestRecovery,clearTestRecovery,withTestRecoveryLock} from "./testCalculationRecoveryStore";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const identity={authUserId:id(1),profileId:id(2)},request={requestId:id(3),name:"Test",deadlineDate:"2090-01-01",items:[{product_id:id(4),quantity:"9223372036854775807"}]};
beforeEach(()=>{vi.restoreAllMocks();installRecoveryBrowser();});
describe("Test Save durable journal",()=>{
 it("round-trips only immutable scoped intent and exact quantities",()=>{
  const record=prepareTestRecovery(identity,request);expect(readTestRecovery(identity)).toEqual(record);
  const raw=localStorage.getItem(testRecoveryKey(identity))!;expect(raw).not.toMatch(/token|password|receipt|reservedQuantity/);
  expect(JSON.parse(raw).request.items[0].quantity).toBe("9223372036854775807");
  expect(()=>prepareTestRecovery(identity,{...request,requestId:id(8)})).toThrow();
 });
 it("isolates backend, actor and profile and does not expire unresolved records",()=>{
  const record=prepareTestRecovery(identity,request);expect(readTestRecovery({...identity,profileId:id(8)})).toBeNull();
  expect(readTestRecovery({...identity,authUserId:id(8)})).toBeNull();
  expect(()=>parseTestRecovery(JSON.stringify({...record,backend:"https://other.invalid"}),identity)).toThrow();
  expect(parseTestRecovery(JSON.stringify({...record,createdAt:"2019-01-01T00:00:00.000Z"}),identity).request).toEqual(request);
 });
 it.each([{schema:2},{state:"resolved"},{token:"private"},{request:{}},{createdAt:"invalid"}])("rejects untrusted extended/corrupt journal %j",patch=>{
  const record=prepareTestRecovery(identity,request);localStorage.setItem(testRecoveryKey(identity),JSON.stringify({...record,...patch}));
  expect(()=>readTestRecovery(identity)).toThrow();expect(localStorage.getItem(testRecoveryKey(identity))).not.toBeNull();
 });
 it("rejects payload replacement and only clears the matching entry",()=>{
  const record=prepareTestRecovery(identity,request);updateTestRecovery(record,"uncertain");
  localStorage.setItem(testRecoveryKey(identity),JSON.stringify({...record,request:{...request,name:"Changed"}}));
  expect(()=>updateTestRecovery(record,"confirmed_success")).toThrow();expect(()=>clearTestRecovery(record)).toThrow();
 });
 it("requires read-back, available storage and Web Locks without fallback",async()=>{
  const write=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{});expect(()=>prepareTestRecovery(identity,request)).toThrow();write.mockRestore();
  Object.defineProperty(navigator,"locks",{configurable:true,value:undefined});expect(()=>readTestRecovery(identity)).toThrow();
  await expect(withTestRecoveryLock(identity,async()=>{})).rejects.toThrow();
 });
 it("fails closed on unavailable reads and quota errors without deleting the record",()=>{
  const record=prepareTestRecovery(identity,request);
  const get=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw Error("denied");});expect(()=>readTestRecovery(identity)).toThrow();get.mockRestore();
  const set=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("quota");});expect(()=>updateTestRecovery(record,"uncertain")).toThrow();set.mockRestore();
  expect(readTestRecovery(identity)?.request.requestId).toBe(request.requestId);
 });
 it("serializes tabs without stealing another run's lock",async()=>{
  let release!:()=>void;const first=withTestRecoveryLock(identity,()=>new Promise<void>(r=>{release=r;}));
  const other=vi.fn();await expect(withTestRecoveryLock(identity,other)).rejects.toThrow();expect(other).not.toHaveBeenCalled();release();await first;
 });
});
