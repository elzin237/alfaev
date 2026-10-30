import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),write:vi.fn(),enabled:true}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../../../app/config/unifiedCommittedActivation",()=>({isUnifiedCommittedEnabled:()=>mocks.enabled}));
vi.mock("../services/unifiedCommittedService",async original=>({...await original<typeof import("../services/unifiedCommittedService")>(),setMaterialAttribution:mocks.write}));
import {useAttributionWorkflow} from "./useAttributionWorkflow";
import {attributionRecoveryKey,readAttributionRecovery,type AttributionIntent} from "../services/materialAttributionRecoveryStore";
import {testRecoveryKey} from "../../test-calculator/services/testCalculationRecoveryStore";
const identity={authUserId:"00000000-0000-4000-8000-000000000001",profileId:"00000000-0000-4000-8000-000000000002"};
const auth={isLoading:false,error:null,isAdmin:true,isActive:true,profile:{id:identity.profileId,authUserId:identity.authUserId,isActive:true},session:{user:{id:identity.authUserId},access_token:"memory-token"}};
const intent:AttributionIntent={workOrderId:"00000000-0000-4000-8000-000000000003",productId:"00000000-0000-4000-8000-000000000004",classification:"independent",request:{requestId:"00000000-0000-4000-8000-000000000005",stateId:"00000000-0000-4000-8000-000000000006",kind:"independent",materialVersion:"2",quantity:"10"}};
const success={ok:true,value:{schema:1,request_id:intent.request.requestId,kind:"independent",state_id:intent.request.stateId}};
function context(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return{client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();localStorage.clear();mocks.enabled=true;mocks.auth.mockReturnValue(auth);mocks.write.mockResolvedValue(success);Object.defineProperty(navigator,"locks",{configurable:true,value:{request:vi.fn(async(_key,_options,work)=>work({name:"owned"}))}});});afterEach(cleanup);
it("OFF and denied Admin scopes never dispatch or initialize a journal",async()=>{mocks.enabled=false;const r=renderHook(()=>useAttributionWorkflow(),context());await act(async()=>{await r.result.current.submit(intent,true);});expect(mocks.write).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);mocks.enabled=true;mocks.auth.mockReturnValue({...auth,isAdmin:false});r.rerender();expect(r.result.current.allowed).toBe(false);await act(async()=>{await r.result.current.submit(intent,true);});expect(mocks.write).not.toHaveBeenCalled();});
it("requires confirmation, persists before dispatch and prevents concurrent duplicate submission",async()=>{
  const r=renderHook(()=>useAttributionWorkflow(),context());await waitFor(()=>expect(r.result.current.ready).toBe(true));
  await act(async()=>{await r.result.current.submit(intent,false);});expect(mocks.write).not.toHaveBeenCalled();
  mocks.write.mockImplementation(async()=>{expect(readAttributionRecovery(identity)?.state).toBe("uncertain");return success;});
  await act(async()=>{await Promise.all([r.result.current.submit(intent,true),r.result.current.submit(intent,true)]);});
  expect(mocks.write).toHaveBeenCalledTimes(1);await waitFor(()=>expect(r.result.current.saved).toBe(true));expect(readAttributionRecovery(identity)).toBeNull();
});
it("recovers after remount with unchanged UUID/payload and preserves Test Save journals",async()=>{
  localStorage.setItem(testRecoveryKey(identity),"existing-Test-Save");mocks.write.mockResolvedValueOnce({ok:false,error:{code:"uncertain",message:"Original request only"}});
  const first=renderHook(()=>useAttributionWorkflow(),context());await waitFor(()=>expect(first.result.current.ready).toBe(true));await act(async()=>{await first.result.current.submit(intent,true);});expect(first.result.current.pending?.intent.request).toEqual(intent.request);first.unmount();
  const recovered=renderHook(()=>useAttributionWorkflow(),context());await waitFor(()=>expect(recovered.result.current.pending?.intent.request.requestId).toBe(intent.request.requestId));
  await act(async()=>{await recovered.result.current.submit({...intent,request:{...intent.request,requestId:intent.workOrderId}},true);});expect(mocks.write).toHaveBeenCalledTimes(1);
  await act(async()=>{await recovered.result.current.recover();});expect(mocks.write).toHaveBeenCalledTimes(2);expect(mocks.write.mock.calls[0]).toEqual(mocks.write.mock.calls[1]);expect(readAttributionRecovery(identity)).toBeNull();expect(localStorage.getItem(testRecoveryKey(identity))).toBe("existing-Test-Save");
});
it("keeps uncertainty after a denied replay but clears a first terminal rejection",async()=>{
  mocks.write.mockResolvedValueOnce({ok:false,error:{code:"uncertain",message:"Unknown"}}).mockResolvedValueOnce({ok:false,error:{code:"rejected",message:"Denied"}});
  const r=renderHook(()=>useAttributionWorkflow(),context());await waitFor(()=>expect(r.result.current.ready).toBe(true));await act(async()=>{await r.result.current.submit(intent,true);});await act(async()=>{await r.result.current.recover();});expect(readAttributionRecovery(identity)?.intent.request).toEqual(intent.request);expect(r.result.current.error).toMatch(/remains unresolved/);
});
it("shows fresh stale-revision rejection and permits no automatic retry",async()=>{
  mocks.write.mockResolvedValue({ok:false,error:{code:"rejected",message:"Stale"}});const r=renderHook(()=>useAttributionWorkflow(),context());await waitFor(()=>expect(r.result.current.ready).toBe(true));await act(async()=>{await r.result.current.submit(intent,true);});expect(r.result.current.error).toMatch(/Reload current/);expect(readAttributionRecovery(identity)).toBeNull();expect(mocks.write).toHaveBeenCalledTimes(1);
});
it("does not dispatch if durable storage cannot be verified",async()=>{
  const r=renderHook(()=>useAttributionWorkflow(),context());await waitFor(()=>expect(r.result.current.ready).toBe(true));vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("storage blocked");});await act(async()=>{await r.result.current.submit(intent,true);});expect(mocks.write).not.toHaveBeenCalled();expect(r.result.current.ready).toBe(false);expect(r.result.current.error).toMatch(/storage cannot be verified/);
});
it("hides an in-flight old profile result and retains its confirmed receipt for recovery",async()=>{
  let finish!:(value:typeof success)=>void;mocks.write.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const r=renderHook(()=>useAttributionWorkflow(),context());await waitFor(()=>expect(r.result.current.ready).toBe(true));
  let pending!:Promise<void>;await act(async()=>{pending=r.result.current.submit(intent,true);await Promise.resolve();});await waitFor(()=>expect(mocks.write).toHaveBeenCalledTimes(1));
  mocks.auth.mockReturnValue({...auth,profile:{...auth.profile,id:intent.workOrderId}});r.rerender();await act(async()=>{finish(success);await pending;});expect(r.result.current.pending).toBeNull();expect(r.result.current.saved).toBe(false);expect(readAttributionRecovery(identity)?.state).toBe("confirmed_success");
  mocks.auth.mockReturnValue(auth);r.rerender();await waitFor(()=>expect(r.result.current.pending?.receipt).not.toBeNull());await act(async()=>{await r.result.current.recover();});expect(mocks.write).toHaveBeenCalledTimes(1);expect(localStorage.getItem(attributionRecoveryKey(identity))).toBeNull();
});
