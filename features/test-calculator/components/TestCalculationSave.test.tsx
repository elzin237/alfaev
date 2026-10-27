import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),save:vi.fn(),reconcile:vi.fn(),preview:vi.fn(),search:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../services/testCalculationSaveService",async original=>({...await original<typeof import("../services/testCalculationSaveService")>(),saveTestCalculation:mocks.save,reconcileTestCalculation:mocks.reconcile}));
vi.mock("../services/testCalculationPreviewService",()=>({previewTestCalculation:mocks.preview}));
vi.mock("../services/testCalculatorSearchService",()=>({searchTestCalculatorProducts:mocks.search}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{}}));
import TestCalculationEditor from "./TestCalculationEditor";
import {installRecoveryBrowser} from "../../../test/finishedGoodsRecoveryBrowser";
import {readTestRecovery} from "../services/testCalculationRecoveryStore";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const product={productId:id(4),name:"Component",serialNumber:"0000123",productKind:"component" as const,sourcePolicy:"raw_customs_fg" as const};
const initial={name:"Test",deadlineDate:"2090-01-01",items:[{product,quantity:"5"}]};
const identity={authUserId:id(1),profileId:id(2)};
const saved={calculationId:id(5),requestId:id(6),name:"Test",deadlineDate:"2090-01-01",createdAt:"2026-10-27T11:00:00Z",expiresAt:"2090-01-01T23:00:00Z",items:[{productId:id(4),name:"Component",serialNumber:"0000123",productKind:"component",required:"5",held:"1",missing:"4",warehouses:[]}]};
function page(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
 <TestCalculationEditor initialDraft={initial} previewEnabledAfterActivation saveEnabledAfterActivation />
</QueryClientProvider>);}
beforeEach(()=>{vi.resetAllMocks();installRecoveryBrowser();mocks.auth.mockReturnValue({session:{user:{id:id(1)},access_token:"memory-token"},profile:{id:id(2),authUserId:id(1),isActive:true},isActive:true,isLoading:false,error:null});
 mocks.preview.mockResolvedValue({ok:true,value:{rows:[{productId:id(4),name:"Component",serialNumber:"0000123",productKind:"component",required:"5",eligibleFree:"5",projectPriority:"0",available:"5",reservable:"5",missing:"0",warehouses:[]}],asOf:"2026-10-27T11:00:00Z",saveWillRecalculate:true}});
 mocks.reconcile.mockResolvedValue(true);mocks.save.mockImplementation(async request=>({ok:true,value:{...saved,requestId:request.requestId}}));});
afterEach(cleanup);
describe("Test Save editor integration (mock services)",()=>{
 it("requires a current proof, persists before Save and displays actual allocation rather than preview",async()=>{
  page();expect(screen.getByRole("button",{name:"Save Test Calculation"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Prove Calculation"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Save Test Calculation"})).not.toBeDisabled());
  mocks.save.mockImplementationOnce(async request=>{expect(readTestRecovery(identity)?.request).toEqual(request);return{ok:true,value:{...saved,requestId:request.requestId}};});
  fireEvent.click(screen.getByRole("button",{name:"Save Test Calculation"}));
  const result=await screen.findByRole("region",{name:"Saved Test Calculation"});expect(result).toHaveTextContent("Reserved 1; Missing 4");
  expect(screen.queryByRole("region",{name:"Test Calculation preview"})).not.toBeInTheDocument();
  expect(mocks.save).toHaveBeenCalledTimes(1);expect(readTestRecovery(identity)).toBeNull();expect(screen.getByLabelText("Calculation name")).toBeDisabled();
 });
 it("invalidates Save availability after editing a successful proof",async()=>{
  page();fireEvent.click(screen.getByRole("button",{name:"Prove Calculation"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Save Test Calculation"})).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Calculation name"),{target:{value:"Edited"}});expect(screen.getByRole("button",{name:"Save Test Calculation"})).toBeDisabled();expect(mocks.save).not.toHaveBeenCalled();
 });
 it("restores unresolved intent after restart and requires explicit recovery without another proof",async()=>{
  mocks.save.mockResolvedValue({ok:false,error:{code:"outcome_uncertain",uncertain:true,message:"Uncertain"}});
  const first=page();fireEvent.click(screen.getByRole("button",{name:"Prove Calculation"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Save Test Calculation"})).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button",{name:"Save Test Calculation"}));await screen.findByRole("alert");
  const request=readTestRecovery(identity)!.request;first.unmount();page();
  expect(await screen.findByRole("region",{name:"Pending Test Save recovery"})).toBeInTheDocument();expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.save.mockResolvedValue({ok:true,value:{...saved,requestId:request.requestId}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Recover original Test Save"}));});
  await screen.findByRole("region",{name:"Saved Test Calculation"});expect(mocks.save.mock.calls[1]![0]).toEqual(request);
 });
});
