import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({list:vi.fn(),detail:vi.fn(),auth:vi.fn()}));
vi.mock("../services/testCalculationHistoryService",async original=>({...await original<typeof import("../services/testCalculationHistoryService")>(),listTestCalculations:mocks.list,getTestCalculation:mocks.detail}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
import TestCalculationHistory from "./TestCalculationHistory";
import {testCalculationHistoryPrefix,prepareTestRecovery,updateTestRecovery,testRecoveryKey} from "../services/testCalculationRecoveryStore";
import {installRecoveryBrowser} from "../../../test/finishedGoodsRecoveryBrowser";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const auth={session:{user:{id:id(1)},access_token:"memory-token"},profile:{id:id(2),authUserId:id(1),isActive:true},isActive:true,isLoading:false,error:null};
const active={calculationId:id(3),name:"Active calculation",creatorFullName:"First Creator",createdAt:"2026-10-27T11:00:00.123456Z",deadlineDate:"2090-01-01",deadlineTimezone:"Europe/Sarajevo",expiresAt:"2090-01-01T23:00:00Z",status:"active",asOf:"2026-10-27T12:00:00Z"};
const expired={...active,calculationId:id(4),name:"Expired calculation",creatorFullName:"Another Creator",createdAt:"2019-01-01T00:00:00Z",deadlineDate:"2020-01-01",expiresAt:"2020-01-01T23:00:00Z",status:"expired"};
const savedDetail={...expired,items:[{itemId:id(5),productId:id(6),name:"Original archived snapshot",serialNumber:"007",productKind:"pcb_finished_good",required:"9223372036854775807",held:"9007199254740993",missing:"9214364837600034814",holds:[{warehouseId:"10000000-0000-4000-8000-000000000002",warehouseCode:"finished_goods",quantity:"9007199254740993"}]}]};
function page(enabled=true,pageSize=20){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const content=<QueryClientProvider client={client}><TestCalculationHistory enabledAfterActivation={enabled} pageSize={pageSize}/></QueryClientProvider>;
 return{client,...render(content),content};}
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();mocks.auth.mockReturnValue(auth);mocks.list.mockResolvedValue({ok:true,value:{rows:[active,expired],nextCursor:null}});mocks.detail.mockResolvedValue({ok:true,value:savedDetail});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("saved Test Calculation history UI (mock services)",()=>{
 it("shows active and expired shared history, both creators, dates and no fabricated list totals",async()=>{
  page();await screen.findByRole("button",{name:"Active calculation"});expect(screen.getByRole("button",{name:"Expired calculation"})).toBeInTheDocument();
  expect(screen.getByText("First Creator")).toBeInTheDocument();expect(screen.getByText("Another Creator")).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader").map(h=>h.textContent)).toEqual(["Calculation","Creator","Created","Deadline (Europe/Sarajevo)","Status"]);
  expect(screen.getByText("Active")).toBeInTheDocument();expect(screen.getByText("Expired")).toBeInTheDocument();expect(screen.getByText("2020-01-01")).toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledWith(20,null,"memory-token",expect.any(AbortSignal));
 });
 it("requests the exact next cursor and appends expired rows without filtering",async()=>{
  const cursor={createdAt:active.createdAt,id:active.calculationId};
  mocks.list.mockResolvedValueOnce({ok:true,value:{rows:[active],nextCursor:cursor}}).mockResolvedValueOnce({ok:true,value:{rows:[expired],nextCursor:null}});
  page(true,1);fireEvent.click(await screen.findByRole("button",{name:"Load more calculations"}));await screen.findByRole("button",{name:"Expired calculation"});
  expect(mocks.list.mock.calls[1]!.slice(0,3)).toEqual([1,cursor,"memory-token"]);expect(screen.queryByRole("button",{name:"Load more calculations"})).not.toBeInTheDocument();
 });
 it("opens saved historical detail and keeps expired bigint allocations visible",async()=>{
  page();fireEvent.click(await screen.findByRole("button",{name:"Expired calculation"}));
  const detail=await screen.findByRole("region",{name:"Saved calculation detail"});
  expect(detail).toHaveTextContent("no longer contribute active Inventory commitments");expect(detail).toHaveTextContent("Original archived snapshot");
  for(const value of ["007","9223372036854775807","9007199254740993","9214364837600034814"])expect(detail).toHaveTextContent(value);
  expect(detail).toHaveTextContent("Finished Goods:");expect(mocks.detail).toHaveBeenCalledWith(id(4),"memory-token",expect.any(AbortSignal));
  for(const label of ["Edit","Cancel","Extend","Delete","Renew"])expect(within(detail).queryByRole("button",{name:label})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Close detail"}));expect(screen.queryByRole("region",{name:"Saved calculation detail"})).not.toBeInTheDocument();
 });
 it("never reads or clears uncertain journals, even for a similar saved calculation",async()=>{
  installRecoveryBrowser();const identity={authUserId:id(1),profileId:id(2)};
  const record=prepareTestRecovery(identity,{requestId:id(9),name:expired.name,deadlineDate:"2020-01-01",items:[{product_id:id(6),quantity:"1"}]});
  updateTestRecovery(record,"uncertain");const key=testRecoveryKey(identity),before=localStorage.getItem(key);
  const remove=vi.spyOn(Storage.prototype,"removeItem"),write=vi.spyOn(Storage.prototype,"setItem"),read=vi.spyOn(Storage.prototype,"getItem");
  page();fireEvent.click(await screen.findByRole("button",{name:"Expired calculation"}));await screen.findByRole("region",{name:"Saved calculation detail"});
  expect(remove).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe(before);
 });
 it("supports pending, empty, denied and retry states without stale rows",async()=>{
  let finish!:(value:unknown)=>void;mocks.list.mockReturnValueOnce(new Promise(r=>{finish=r;}));page();
  expect(screen.getByRole("status")).toHaveTextContent("Loading saved calculations");
  await act(async()=>{finish({ok:false,error:{code:"access_denied",message:"Test history permission denied."}});});
  expect(await screen.findByRole("alert")).toHaveTextContent("Test history permission denied");expect(screen.queryByRole("table")).not.toBeInTheDocument();
  mocks.list.mockResolvedValue({ok:true,value:{rows:[],nextCursor:null}});fireEvent.click(screen.getByRole("button",{name:"Try again"}));
  expect(await screen.findByRole("heading",{name:"No saved calculations"})).toBeInTheDocument();
 });
 it("handles missing detail and safe network errors with retry",async()=>{
  mocks.detail.mockResolvedValueOnce({ok:false,error:{code:"not_found",message:"Saved calculation not found."}});page();fireEvent.click(await screen.findByRole("button",{name:"Expired calculation"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("not found");fireEvent.click(screen.getByRole("button",{name:"Try again"}));
  await screen.findByRole("region",{name:"Saved calculation detail"});
 });
 it("hides previous identity's rows/detail and never reopens the old selection under another account",async()=>{
  const r=page();fireEvent.click(await screen.findByRole("button",{name:"Expired calculation"}));await screen.findByRole("region",{name:"Saved calculation detail"});
  mocks.auth.mockReturnValue({...auth,session:{user:{id:id(8)},access_token:"other-token"},profile:{...auth.profile,id:id(9),authUserId:id(8)}});
  mocks.list.mockReturnValueOnce(new Promise(()=>{}));r.rerender(<QueryClientProvider client={r.client}><TestCalculationHistory enabledAfterActivation/></QueryClientProvider>);
  expect(screen.queryByRole("button",{name:"Expired calculation"})).not.toBeInTheDocument();expect(screen.queryByRole("region",{name:"Saved calculation detail"})).not.toBeInTheDocument();expect(mocks.detail).toHaveBeenCalledTimes(1);
 });
 it("confirmed-Save prefix invalidation refreshes active list/detail but never clears a journal",async()=>{
  const r=page();fireEvent.click(await screen.findByRole("button",{name:"Expired calculation"}));await screen.findByRole("region",{name:"Saved calculation detail"});
  await act(async()=>{await r.client.invalidateQueries({queryKey:testCalculationHistoryPrefix({authUserId:id(1),profileId:id(2)})});});
  expect(mocks.list).toHaveBeenCalledTimes(2);expect(mocks.detail).toHaveBeenCalledTimes(2);
 });
 it("disabled rendering does not request Auth or data; inactive access fails closed",async()=>{
  const off=page(false);expect(mocks.list).not.toHaveBeenCalled();expect(mocks.auth).not.toHaveBeenCalled();off.unmount();
  mocks.auth.mockReturnValue({...auth,isActive:false});page();expect(screen.getByRole("alert")).toHaveTextContent("Access denied");expect(mocks.list).not.toHaveBeenCalled();
 });
});
