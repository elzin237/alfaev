import {cleanup,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({enabled:true}));
vi.mock("../../../app/config/unifiedCommittedActivation",()=>({isUnifiedCommittedEnabled:()=>mocks.enabled}));
vi.mock("../../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>true}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:()=>false}));
vi.mock("./UnifiedCommittedCell",()=>({default:({warehouseId}:{warehouseId:string})=><span data-testid="committed" data-warehouse={warehouseId}>{warehouseId.endsWith("1")?"91":"68"}</span>}));
import ProductList from "./ProductList";
import {AllInventoryTable} from "./AllInventoryView";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
const product={id:"p",serialNumber:"0000001",name:"Component",category:"Parts",brandName:null,productKind:"component" as const,isActive:true,quantity:9007199254740993n};
beforeEach(()=>{mocks.enabled=true;});afterEach(cleanup);
it.each(INVENTORY_WAREHOUSES)("prepares one Committed column for $code without changing other quantities",warehouse=>{
  render(<MemoryRouter><ProductList products={[product]} warehouseCode={warehouse.code} showCommitments={warehouse.code!=="customs"} showWorkOrderCommitments/></MemoryRouter>);
  expect(screen.getByRole("columnheader",{name:"Committed"})).toHaveClass("text-center");expect(screen.queryByRole("columnheader",{name:"Project Demand"})).not.toBeInTheDocument();expect(screen.queryByRole("columnheader",{name:"WO Held"})).not.toBeInTheDocument();
  expect(screen.getByTestId("committed")).toHaveAttribute("data-warehouse",warehouse.id);expect(screen.getByTestId("committed")).toHaveTextContent(warehouse.code==="raw_materials"?"91":"68");expect(screen.getByText("9007199254740993")).toBeInTheDocument();
  if(warehouse.code==="finished_goods")expect(screen.getByRole("columnheader",{name:"FG Reserved"})).toBeInTheDocument();
});
it("prepares All Inventory with exact row warehouse context and existing scrolling",()=>{
  render(<MemoryRouter><AllInventoryTable rows={INVENTORY_WAREHOUSES.map(warehouse=>({warehouse,product,commitment:undefined,test:undefined,health:undefined}))} testsEnabled={false} showWorkOrderCommitments/></MemoryRouter>);
  expect(screen.getAllByTestId("committed").map(e=>e.getAttribute("data-warehouse"))).toEqual(INVENTORY_WAREHOUSES.map(w=>w.id));expect(screen.getAllByTestId("committed").map(e=>e.textContent)).toEqual(["91","68","68"]);expect(screen.getByRole("columnheader",{name:"Committed"})).toBeInTheDocument();expect(screen.queryByRole("columnheader",{name:"WO Held"})).not.toBeInTheDocument();expect(screen.getByRole("region",{name:"All Inventory results"})).toHaveClass("overflow-auto");
});
it("OFF preserves the old columns without mounting the new cell",()=>{mocks.enabled=false;render(<MemoryRouter><ProductList products={[product]} showWorkOrderCommitments/></MemoryRouter>);expect(screen.getByRole("columnheader",{name:"Project Demand"})).toBeInTheDocument();expect(screen.getByRole("columnheader",{name:"WO Held"})).toBeInTheDocument();expect(screen.queryByTestId("committed")).not.toBeInTheDocument();});
