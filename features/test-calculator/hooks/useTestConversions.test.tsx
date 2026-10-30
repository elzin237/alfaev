import {cleanup,renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),gate:vi.fn(),read:vi.fn(),permission:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../../../app/auth/permissionService",()=>({hasPermission:mocks.permission}));
vi.mock("../../../app/config/testCalculationImportActivation",()=>({isTestCalculationImportEnabled:mocks.gate}));
vi.mock("../services/testCalculationConversionService",()=>({getTestConversions:mocks.read}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{}}));
import {useTestConversions} from "./useTestConversions";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const auth={session:{user:{id:id(1)},access_token:"token"},profile:{id:id(2),authUserId:id(1),isActive:true},isAdmin:true,isActive:true,isLoading:false,error:null};
const value={as_of:"2026-10-30T00:00:00Z",next_expiry:null,rows:[{calculation_id:id(3),imported:false,can_navigate:false,destination:null,items:[]}]};
function setup(ids=[id(3)]){const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 return{client,...renderHook(()=>useTestConversions(ids),{wrapper})};}
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockReturnValue(auth);mocks.gate.mockReturnValue(true);mocks.read.mockResolvedValue(value);mocks.permission.mockResolvedValue({ok:true,value:true});});
afterEach(cleanup);
it("bounds each request at 100 sources without N+1 calls",async()=>{
  const ids=Array.from({length:101},(_,i)=>id(i+10));mocks.read.mockImplementation(async selected=>({...value,rows:selected.map((calculation_id:string)=>({...value.rows[0],calculation_id}))}));
  const r=setup(ids);await waitFor(()=>expect(r.result.current.ready).toBe(true));expect(mocks.read).toHaveBeenCalledTimes(2);expect(mocks.read.mock.calls.map(call=>call[0].length)).toEqual([100,1]);
});
it("uses the server lifetime including transport time, rejecting already-expired snapshots and refreshing once",async()=>{
  mocks.read.mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve({...value,next_expiry:"2026-10-30T00:00:00.010Z"}),25)));
  const r=setup();await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));await waitFor(()=>expect(r.result.current.ready).toBe(true));expect(r.result.current.rows).toEqual(value.rows);
});
it("gate OFF and invalid actor scopes perform no conversion reads",async()=>{
  mocks.gate.mockReturnValue(false);const r=setup();expect(r.result.current.released).toBe(false);expect(mocks.read).not.toHaveBeenCalled();r.unmount();
  mocks.gate.mockReturnValue(true);mocks.auth.mockReturnValue({...auth,profile:{...auth.profile,authUserId:id(99)}});setup();expect(mocks.read).not.toHaveBeenCalled();
});
