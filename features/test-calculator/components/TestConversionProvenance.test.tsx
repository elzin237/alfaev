import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({gate:vi.fn(),auth:vi.fn(),list:vi.fn(),detail:vi.fn(),metadata:vi.fn(),permission:vi.fn()}));
vi.mock("../../../app/config/testCalculationImportActivation",()=>({isTestCalculationImportEnabled:mocks.gate}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../../../app/auth/permissionService",()=>({hasPermission:mocks.permission}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{}}));
vi.mock("../services/testCalculationHistoryService",async original=>({...await original<typeof import("../services/testCalculationHistoryService")>(),listTestCalculations:mocks.list,getTestCalculation:mocks.detail}));
vi.mock("../services/testCalculationConversionService",()=>({getTestConversions:mocks.metadata}));
import TestCalculationHistory from "./TestCalculationHistory";
import {testCalculationImportPrefix,invalidateTestImport} from "../testCalculationImportQueryKeys";
import {importReceipt} from "../../../test/testCalculationImportFixtures";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const identity={authUserId:id(1),profileId:id(2)};
const auth={session:{user:{id:id(1)},access_token:"memory-token"},profile:{id:id(2),authUserId:id(1),isActive:true},isAdmin:true,isActive:true,isLoading:false,error:null};
const header={calculationId:id(3),name:"Imported active Test",creatorFullName:"Original Creator",createdAt:"2026-10-27T11:00:00Z",deadlineDate:"2090-01-01",deadlineTimezone:"Europe/Sarajevo",expiresAt:"2090-01-01T23:00:00Z",status:"active",asOf:"2026-10-30T00:00:00Z"};
const item={itemId:id(5),productId:id(6),name:"Immutable component",serialNumber:"0000123",productKind:"component",required:"9223372036854775807",held:"9007199254740993",missing:"9214364837600034814",holds:[{warehouseId:"10000000-0000-4000-8000-000000000001",warehouseCode:"raw_materials",quantity:"9007199254740993"}]};
const destination={calculator_id:id(7),product_id:id(8),serial_number:"006",imported_at:"2026-10-29T11:00:00Z"};
function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const tree=()=> <QueryClientProvider client={client}><MemoryRouter><TestCalculationHistory enabledAfterActivation/></MemoryRouter></QueryClientProvider>;
  const view=render(tree());return{client,...view,refresh:()=>view.rerender(tree())};}
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockReturnValue(true);mocks.auth.mockReturnValue(auth);mocks.permission.mockResolvedValue({ok:true,value:true});
  mocks.list.mockResolvedValue({ok:true,value:{rows:[header],nextCursor:null}});mocks.detail.mockResolvedValue({ok:true,value:{...header,items:[item]}});
  mocks.metadata.mockImplementation(async(ids:string[],_token:string,commitments:boolean)=>({as_of:header.asOf,next_expiry:null,rows:ids.map(calculation_id=>({calculation_id,imported:true,can_navigate:true,destination,items:commitments?[{item_id:item.itemId,product_id:item.productId,effective_quantity:"0",warehouses:[]}]:[]}))}));
});
afterEach(cleanup);
it("shows Imported independently of Active and authorized navigation without changing original quantities",async()=>{
  setup();await screen.findByText("Imported");expect(screen.getByText("Active")).toBeInTheDocument();expect(screen.getByRole("link",{name:"View Calculator"})).toHaveAttribute("href",`/pcb/${destination.calculator_id}`);
  fireEvent.click(screen.getByRole("button",{name:header.name}));const detail=await screen.findByRole("region",{name:"Saved calculation detail"});
  await waitFor(()=>expect(within(detail).getByText("Imported")).toBeInTheDocument());
  expect(detail).toHaveTextContent("Output serial: 006");expect(detail).toHaveTextContent(destination.product_id);expect(detail).toHaveTextContent("Original Creator");
  expect(detail).toHaveTextContent(item.held);expect(detail).toHaveTextContent(item.required);expect(detail).toHaveTextContent("Originally held quantities remain unchanged");
  expect(within(detail).getByRole("columnheader",{name:"Effective commitments"})).toBeInTheDocument();expect(within(detail).getByText("0",{exact:true})).toBeInTheDocument();
});
it("does not replace Expired with Imported",async()=>{
  mocks.list.mockResolvedValue({ok:true,value:{rows:[{...header,status:"expired",deadlineDate:"2020-01-01",expiresAt:"2020-01-01T23:00:00Z"}],nextCursor:null}});
  setup();await screen.findByText("Imported");expect(screen.getByText("Expired")).toBeInTheDocument();expect(screen.queryByText("Active",{exact:true})).not.toBeInTheDocument();
});
it("Test view does not grant destination access, even if stale cached metadata contains destination IDs",async()=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:false});mocks.permission.mockResolvedValue({ok:true,value:false});setup();await screen.findByText("Imported");
  expect(screen.queryByRole("link",{name:"View Calculator"})).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:header.name}));
  const detail=await screen.findByRole("region",{name:"Saved calculation detail"});await within(detail).findByText("Destination details require current Product Calculator access.");
  expect(detail).not.toHaveTextContent(destination.product_id);expect(detail).not.toHaveTextContent("Output serial: 006");
});
it("gate OFF preserves legacy history and never requests conversion or permission RPCs",async()=>{
  mocks.gate.mockReturnValue(false);setup();fireEvent.click(await screen.findByRole("button",{name:header.name}));await screen.findByRole("region",{name:"Saved calculation detail"});
  expect(mocks.metadata).not.toHaveBeenCalled();expect(mocks.permission).not.toHaveBeenCalled();expect(screen.queryByText("Imported",{exact:true})).not.toBeInTheDocument();expect(screen.queryByRole("columnheader",{name:"Effective commitments"})).not.toBeInTheDocument();
});
it("metadata loading and errors never fabricate current commitments or Imported state",async()=>{
  let reject!:(value:Error)=>void;mocks.metadata.mockImplementationOnce(()=>new Promise((_resolve,r)=>{reject=r;}));setup();
  await screen.findByText("Loading conversion status…");expect(screen.queryByText("Imported",{exact:true})).not.toBeInTheDocument();
  await act(async()=>{reject(Error("unavailable"));});await screen.findByText("Conversion status unavailable.");
  fireEvent.click(screen.getByRole("button",{name:"Retry conversion status"}));await screen.findByText("Imported");
});
it("profile switches do not expose previous provenance and success invalidation refreshes only its own metadata",async()=>{
  const r=setup();await screen.findByText("Imported");
  await act(async()=>{await invalidateTestImport(r.client,identity,importReceipt());});expect(mocks.metadata.mock.calls.length).toBeGreaterThan(1);
  expect(r.client.getQueryCache().findAll({queryKey:testCalculationImportPrefix(identity)})).not.toHaveLength(0);
  mocks.auth.mockReturnValue({...auth,session:{user:{id:id(20)},access_token:"new-token"},profile:{id:id(21),authUserId:id(20),isActive:true}});
  mocks.list.mockReturnValueOnce(new Promise(()=>{}));r.refresh();expect(screen.queryByText("Imported",{exact:true})).not.toBeInTheDocument();expect(screen.queryByRole("link",{name:"View Calculator"})).not.toBeInTheDocument();
});
it("renders authoritative remaining commitments rather than inferring zero from Imported",async()=>{
  mocks.metadata.mockImplementation(async(ids:string[],_token:string,commitments:boolean)=>({as_of:header.asOf,next_expiry:null,rows:ids.map(calculation_id=>({calculation_id,imported:true,can_navigate:true,destination,items:commitments?[{item_id:item.itemId,product_id:item.productId,effective_quantity:"2",warehouses:[{warehouse_id:item.holds[0]!.warehouseId,quantity:"2"}]}]:[]}))}));
  setup();fireEvent.click(await screen.findByRole("button",{name:header.name}));const detail=await screen.findByRole("region",{name:"Saved calculation detail"});
  await within(detail).findByText("2",{exact:true});expect(detail).toHaveTextContent(item.held);
});
