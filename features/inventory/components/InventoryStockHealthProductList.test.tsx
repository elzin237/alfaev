import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Stock-health fixtures remain independent of the DEV WO-read release switch.
vi.mock("../../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>false}));
const mocks=vi.hoisted(()=>({hook:vi.fn(),gate:vi.fn(),save:vi.fn(),refetch:vi.fn()}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:mocks.gate}));
vi.mock("../hooks/useInventoryStockHealth",()=>({useInventoryStockHealth:mocks.hook}));
import InventoryStockHealthProductList from "./InventoryStockHealthProductList";
import type { InventoryStockHealth } from "../services/inventoryStockHealthService";
import type { ProductListItem } from "../services/productService";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
const raw="10000000-0000-4000-8000-000000000001";
const product:ProductListItem={id:"00000000-0000-4000-8000-000000000001",serialNumber:"001",name:"Resistor",category:"Components",brandName:null,productKind:"component",isActive:true,quantity:10};
const row:InventoryStockHealth={productId:product.id,warehouseId:raw,productName:product.name,isActive:true,physicalQuantity:"10",minimumQuantity:"9007199254740993",version:"9007199254740993",status:"LOW_STOCK"};
function show(products=[product]){return render(<MemoryRouter><InventoryStockHealthProductList products={products} warehouseCode="raw_materials" warehouseId={raw} search="resistor" authorizedWarehouseIds={[raw]} showCommitments={false}/></MemoryRouter>);}
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockReturnValue(true);mocks.save.mockResolvedValue({ok:true,value:{}});mocks.hook.mockReturnValue({allowed:true,canEdit:true,rows:[row],save:mocks.save,query:{isFetching:false,refetch:mocks.refetch}});});
afterEach(cleanup);
it.each(INVENTORY_WAREHOUSES)("removes minimum configuration but preserves authoritative health in $label",warehouse=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:[{...row,warehouseId:warehouse.id}]});
  render(<MemoryRouter><InventoryStockHealthProductList products={[product]} warehouseCode={warehouse.code} warehouseId={warehouse.id} search="" authorizedWarehouseIds={[warehouse.id]} showCommitments={false}/></MemoryRouter>);
  expect(screen.queryByRole("columnheader",{name:"Minimum Stock"})).not.toBeInTheDocument();
  expect(screen.getByRole("columnheader",{name:warehouse.code==="customs"?"Stock Health":"Health"})).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getByText("Low Stock")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/Minimum/})).not.toBeInTheDocument();
});
it("OFF preserves the old table and never mounts the health hook",()=>{mocks.gate.mockReturnValue(false);show();expect(mocks.hook).not.toHaveBeenCalled();expect(screen.queryByRole("columnheader",{name:"Minimum Stock"})).not.toBeInTheDocument();expect(screen.getByText("10")).toBeInTheDocument();});
it("keeps health without minimum configuration separately from Active status and physical stock",()=>{
  show();expect(screen.queryByRole("columnheader",{name:"Minimum Stock"})).not.toBeInTheDocument();expect(screen.queryByText("9007199254740993")).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/minimum/i})).not.toBeInTheDocument();
  expect(within(screen.getByRole("table")).getByText("Low Stock")).toBeInTheDocument();expect(screen.getByText("Active")).toBeInTheDocument();expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByRole("link",{name:product.name})).toHaveAttribute("href",`/inventory/${product.id}?warehouse=raw_materials`);
});
it.each([["HEALTHY","Healthy"],["LOW_STOCK","Low Stock"],["OUT_OF_STOCK","Out of Stock"],["NOT_CONFIGURED","Not Set"]])("renders authoritative %s separately from Product status",(status,label)=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:[{...row,status}]});show();expect(within(screen.getByRole("table")).getByText(label)).toBeInTheDocument();expect(screen.getByText("Active")).toBeInTheDocument();
});
it.each(INVENTORY_WAREHOUSES)("shortens only the unconfigured badge in $label while preserving its filter",warehouse=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:[{...row,warehouseId:warehouse.id,status:"NOT_CONFIGURED",minimumQuantity:null}]});
  render(<MemoryRouter><InventoryStockHealthProductList products={[product]} warehouseCode={warehouse.code} warehouseId={warehouse.id} search="" authorizedWarehouseIds={[warehouse.id]} showCommitments={false}/></MemoryRouter>);
  const badge=within(screen.getByRole("table")).getByText("Not Set");
  expect(badge).toHaveClass("bg-zinc-100","text-zinc-700","border-zinc-200");
  expect(screen.getByRole("option",{name:"Not Configured"})).toHaveValue("NOT_CONFIGURED");
  fireEvent.change(screen.getByRole("combobox",{name:"Stock Health"}),{target:{value:"NOT_CONFIGURED"}});
  expect(mocks.hook).toHaveBeenLastCalledWith(warehouse.id,"","NOT_CONFIGURED",true);
});
it("renders a successful empty health filter without changing editing or navigation",()=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:[]});show();fireEvent.change(screen.getByRole("combobox",{name:"Stock Health"}),{target:{value:"HEALTHY"}});expect(screen.getByRole("status")).toHaveTextContent("No Products match");
});
it.each(["archived","permission"])("does not expose configuration for %s",state=>{
  mocks.hook.mockReturnValue({...mocks.hook(),canEdit:state!=="permission",rows:[{...row,isActive:state!=="archived"}]});show([{...product,isActive:state!=="archived"}]);expect(screen.queryByRole("button",{name:/Configure minimum/})).not.toBeInTheDocument();
});
it("filters authoritative rows while preserving Product order and search scope",()=>{
  const second={...product,id:"00000000-0000-4000-8000-000000000002",serialNumber:"000",name:"Second"};show([second,product]);
  expect(screen.getAllByRole("row").slice(1).map(r=>within(r).getByRole("rowheader").textContent)).toEqual(["000","001"]);
  fireEvent.change(screen.getByRole("combobox",{name:"Stock Health"}),{target:{value:"LOW_STOCK"}});
  expect(mocks.hook).toHaveBeenLastCalledWith(raw,"resistor","LOW_STOCK",true);expect(screen.queryByRole("link",{name:"Second"})).not.toBeInTheDocument();
});
it.each([true,false])("shows unavailable, never fabricated minimum/status, while fetching=%s",fetching=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:undefined,query:{isFetching:fetching,refetch:mocks.refetch}});show();expect(screen.getAllByText("Unavailable")).toHaveLength(1);expect(screen.getByText("10")).toBeInTheDocument();expect(screen.queryByRole("button",{name:/Configure minimum/})).not.toBeInTheDocument();
});
