import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {MemoryRouter} from "react-router";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({enabled:true,read:vi.fn(),refetch:vi.fn()}));
vi.mock("../../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>mocks.enabled}));
vi.mock("../../../app/config/unifiedCommittedActivation",()=>({isUnifiedCommittedEnabled:()=>false}));
vi.mock("../hooks/useInventoryHeldAccounting",()=>({useInventoryHeldAccounting:mocks.read}));
// Popup authorization/redaction/navigation is exercised using the real cell in InventoryCommitmentDialog tests.
vi.mock("./CommitmentQuantity",()=>({default:({value,warehouseCode,metric}:{value:string;warehouseCode:string;metric:string})=><span data-metric={metric} data-warehouse={warehouseCode}>{value}</span>}));
import InventoryHeldProductList from "./InventoryHeldProductList";
import {InventoryAccountingTable} from "./AllInventoryView";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
import type {InventoryReservationAccountingRow} from "../services/inventoryReservationAccountingService";
const ids=INVENTORY_WAREHOUSES.map(w=>w.id);
const product={id:"product",name:"Component",serialNumber:"006",category:"Part",brandName:null,productKind:"component" as const,isActive:true,quantity:100n};
const accounting={productId:product.id,warehouseWorkOrderHeld:"9007199254740993",workOrderHeld:"9007199254740999",netAvailableAfterAllCommitments:"-17"} as InventoryReservationAccountingRow;
const state=()=>({allowed:true,rows:new Map([[product.id,accounting]]),query:{isFetching:false,refetch:mocks.refetch}});
beforeEach(()=>{vi.resetAllMocks();mocks.enabled=true;mocks.read.mockReturnValue(state());});afterEach(cleanup);
function list(index=0){const w=INVENTORY_WAREHOUSES[index]!;return render(<MemoryRouter><InventoryHeldProductList products={[product]} warehouseId={w.id} warehouseCode={w.code} search="part" authorizedWarehouseIds={ids} showCommitments={false}/></MemoryRouter>);}
it.each([0,1,2])("shows warehouse-specific exact Held and authoritative net for warehouse %s",index=>{
  list(index);expect(mocks.read).toHaveBeenCalledWith(ids[index],"part",ids);
  const held=screen.getByRole("columnheader",{name:"WO Held"}),net=screen.getByRole("columnheader",{name:"Net incl. WO"});
  expect(held).toHaveClass("text-center");expect(net).toHaveClass("text-center");expect(held).toHaveAttribute("title",expect.stringContaining("Uncovered"));
  expect(screen.getByText(accounting.warehouseWorkOrderHeld)).toHaveAttribute("data-warehouse",INVENTORY_WAREHOUSES[index]!.code);
  expect(screen.getByText(accounting.warehouseWorkOrderHeld)).toHaveAttribute("data-metric","work_order_reservation");
  expect(screen.queryByText(accounting.workOrderHeld)).not.toBeInTheDocument();expect(screen.getByText("-17")).toHaveClass("text-red-700");
  expect(screen.getByText("100")).toBeInTheDocument();expect(screen.getByRole("link",{name:product.name})).toHaveAttribute("href",`/inventory/product?warehouse=${INVENTORY_WAREHOUSES[index]!.code}`);
});
it("gate OFF mounts neither accounting hook nor new columns",()=>{
  mocks.enabled=false;list();expect(mocks.read).not.toHaveBeenCalled();expect(screen.queryByRole("columnheader",{name:"WO Held"})).not.toBeInTheDocument();expect(screen.queryByRole("columnheader",{name:"Net incl. WO"})).not.toBeInTheDocument();
});
it("preserves actual zero allocations without substituting required/uncovered quantities",()=>{
  mocks.read.mockReturnValue({...state(),rows:new Map([[product.id,{...accounting,warehouseWorkOrderHeld:"0",netAvailableAfterAllCommitments:"100"}]])});list();expect(screen.getByText("0")).toHaveAttribute("data-metric","work_order_reservation");
});
it.each(["loading","denied","missing"])("keeps %s accounting unavailable, with bounded manual retry only when authorized",kind=>{
  mocks.read.mockReturnValue({...state(),allowed:kind!=="denied",rows:kind==="missing"?new Map():undefined,query:{isFetching:kind==="loading",refetch:mocks.refetch}});list();
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  expect(screen.getByRole(kind==="loading"?"status":"alert")).toHaveTextContent(kind==="loading"?/Loading/:/unavailable/);
  if(kind==="denied")expect(screen.queryByRole("button",{name:"Refresh WO commitments"})).not.toBeInTheDocument();
  else if(kind==="loading")expect(screen.getByRole("button",{name:"Refresh WO commitments"})).toBeDisabled();
  else{fireEvent.click(screen.getByRole("button",{name:"Refresh WO commitments"}));expect(mocks.refetch).toHaveBeenCalledWith({cancelRefetch:false});}
});
it("keeps duplicate Products separate across All Inventory warehouses, sticky viewport and warehouse permissions",()=>{
  const rows=INVENTORY_WAREHOUSES.map(warehouse=>({product,warehouse,commitment:undefined,test:undefined,health:undefined}));
  mocks.read.mockImplementation((warehouse:string)=>({...state(),rows:new Map([[product.id,{...accounting,warehouseWorkOrderHeld:String(ids.indexOf(warehouse)+1)}]])}));
  render(<MemoryRouter><InventoryAccountingTable rows={rows} search="part" testsEnabled={false} authorizedWarehouseIds={ids}/></MemoryRouter>);
  const records=screen.getAllByRole("row").slice(1);expect(records).toHaveLength(3);
  records.forEach((record,index)=>{expect(within(record).getByText(String(index+1))).toHaveAttribute("data-warehouse",INVENTORY_WAREHOUSES[index]!.code);expect(within(record).getByRole("link")).toHaveAttribute("href",`/inventory/product?warehouse=${INVENTORY_WAREHOUSES[index]!.code}`);});
  expect(screen.getByRole("region",{name:"All Inventory results"})).toHaveClass("max-h-[min(34rem,70dvh)]","overflow-auto");
  expect(screen.getByRole("columnheader",{name:"Net incl. WO"})).toHaveAccessibleDescription(/Raw \+ Customs.*Each deducted once/);
});
it("All gate OFF keeps the existing columns and mounts no accounting reads",()=>{
  mocks.enabled=false;render(<MemoryRouter><InventoryAccountingTable rows={[{product,warehouse:INVENTORY_WAREHOUSES[0]!,commitment:undefined,test:undefined,health:undefined}]} search="" testsEnabled={false} authorizedWarehouseIds={ids}/></MemoryRouter>);
  expect(mocks.read).not.toHaveBeenCalled();expect(screen.queryByRole("columnheader",{name:"WO Held"})).not.toBeInTheDocument();
});
