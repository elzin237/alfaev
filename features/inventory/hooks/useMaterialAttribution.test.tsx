import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),write:vi.fn(),enabled:true}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../../../app/config/unifiedCommittedActivation",()=>({isUnifiedCommittedEnabled:()=>mocks.enabled}));
vi.mock("../services/unifiedCommittedService",async original=>({...await original<typeof import("../services/unifiedCommittedService")>(),setMaterialAttribution:mocks.write}));
import {useMaterialAttribution} from "./useMaterialAttribution";
import {unifiedCommittedPrefix,type AttributionRequest} from "../services/unifiedCommittedService";
const auth={session:{user:{id:"actor"},access_token:"memory-token"},profile:{id:"profile",authUserId:"actor",isActive:true},isAdmin:true,isActive:true,isLoading:false,error:null};
const input:AttributionRequest={requestId:"request",stateId:"state",kind:"independent",materialVersion:"2",quantity:"10"};
function context(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});return{client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
beforeEach(()=>{vi.resetAllMocks();mocks.enabled=true;mocks.auth.mockReturnValue(auth);mocks.write.mockResolvedValue({ok:true,value:{schema:1,request_id:"request",kind:"independent",state_id:"state"}});});afterEach(cleanup);
it("OFF and non-Admin deny mutation without RPC dispatch",async()=>{mocks.enabled=false;const r=renderHook(()=>useMaterialAttribution(),context());await act(async()=>{await r.result.current.mutation.mutateAsync(input);});expect(mocks.write).not.toHaveBeenCalled();mocks.enabled=true;mocks.auth.mockReturnValue({...auth,isAdmin:false});r.rerender();await act(async()=>{await r.result.current.mutation.mutateAsync(input);});expect(mocks.write).not.toHaveBeenCalled();});
it("invalidates only dispatch-time scoped reads after authoritative success",async()=>{
  const ctx=context(),own=unifiedCommittedPrefix("actor","profile"),other=unifiedCommittedPrefix("other","profile");ctx.client.setQueryData([...own,"p"],{});ctx.client.setQueryData([...other,"p"],{});
  const r=renderHook(()=>useMaterialAttribution(),ctx);await act(async()=>{await r.result.current.mutation.mutateAsync(input);});
  expect(mocks.write).toHaveBeenCalledWith(input,"memory-token");expect(ctx.client.getQueryState([...own,"p"])?.isInvalidated).toBe(true);expect(ctx.client.getQueryState([...other,"p"])?.isInvalidated).toBe(false);
  await waitFor(()=>expect(r.result.current.mutation.data?.result.ok).toBe(true));
  mocks.auth.mockReturnValue({...auth,profile:{...auth.profile,id:"different"}});r.rerender();expect(r.result.current.mutation.data).toBeUndefined();expect(r.result.current.mutation.variables).toBeUndefined();
});
it("uncertain responses do not invalidate as success or automatically dispatch again",async()=>{
  const ctx=context(),own=unifiedCommittedPrefix("actor","profile");ctx.client.setQueryData([...own,"p"],{});mocks.write.mockResolvedValue({ok:false,error:{code:"uncertain",message:"Retry original request"}});
  const r=renderHook(()=>useMaterialAttribution(),ctx);await act(async()=>{await r.result.current.mutation.mutateAsync(input);});expect(mocks.write).toHaveBeenCalledTimes(1);expect(ctx.client.getQueryState([...own,"p"])?.isInvalidated).toBe(false);
});
