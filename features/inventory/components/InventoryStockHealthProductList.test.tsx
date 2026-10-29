import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({hook:vi.fn(),gate:vi.fn(),save:vi.fn(),refetch:vi.fn()}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:mocks.gate}));
vi.mock("../hooks/useInventoryStockHealth",()=>({useInventoryStockHealth:mocks.hook}));
import InventoryStockHealthProductList from "./InventoryStockHealthProductList";
import type { InventoryStockHealth } from "../services/inventoryStockHealthService";
import type { ProductListItem } from "../services/productService";
const raw="10000000-0000-4000-8000-000000000001";
const product:ProductListItem={id:"00000000-0000-4000-8000-000000000001",serialNumber:"001",name:"Resistor",category:"Components",brandName:null,productKind:"component",isActive:true,quantity:10};
const row:InventoryStockHealth={productId:product.id,warehouseId:raw,productName:product.name,isActive:true,physicalQuantity:"10",minimumQuantity:"9007199254740993",version:"9007199254740993",status:"LOW_STOCK"};
function show(products=[product]){return render(<MemoryRouter><InventoryStockHealthProductList products={products} warehouseCode="raw_materials" warehouseId={raw} search="resistor" authorizedWarehouseIds={[raw]} showCommitments={false}/></MemoryRouter>);}
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockReturnValue(true);mocks.save.mockResolvedValue({ok:true,value:{}});mocks.hook.mockReturnValue({allowed:true,canEdit:true,rows:[row],save:mocks.save,query:{isFetching:false,refetch:mocks.refetch}});});
afterEach(cleanup);
it("OFF preserves the old table and never mounts the health hook",()=>{mocks.gate.mockReturnValue(false);show();expect(mocks.hook).not.toHaveBeenCalled();expect(screen.queryByRole("columnheader",{name:"Minimum Stock"})).not.toBeInTheDocument();expect(screen.getByText("10")).toBeInTheDocument();});
it("adds minimum/health separately from Active status without changing physical stock or links",()=>{
  show();expect(screen.getByRole("columnheader",{name:"Minimum Stock"})).toBeInTheDocument();expect(screen.getByText("9007199254740993")).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getByText("Low Stock")).toBeInTheDocument();expect(screen.getByText("Active")).toBeInTheDocument();expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByRole("link",{name:product.name})).toHaveAttribute("href",`/inventory/${product.id}?warehouse=raw_materials`);
});
it.each([["HEALTHY","Healthy"],["LOW_STOCK","Low Stock"],["OUT_OF_STOCK","Out of Stock"],["NOT_CONFIGURED","Not Configured"]])("renders authoritative %s separately from Product status",(status,label)=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:[{...row,status}]});show();expect(within(screen.getByRole("table")).getByText(label)).toBeInTheDocument();expect(screen.getByText("Active")).toBeInTheDocument();
});
it("renders a successful empty health filter without changing editing or navigation",()=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:[]});show();fireEvent.change(screen.getByRole("combobox",{name:"Stock Health"}),{target:{value:"HEALTHY"}});expect(screen.getByRole("status")).toHaveTextContent("No Products match");
});
it("updates and clears using the exact displayed version",async()=>{
  show();fireEvent.click(screen.getByRole("button",{name:/Configure minimum/}));fireEvent.change(screen.getByRole("textbox",{name:/Minimum for/}),{target:{value:"9223372036854775807"}});
  fireEvent.click(screen.getByRole("button",{name:"Save minimum"}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(product.id,"9223372036854775807",row.version));
  await waitFor(()=>expect(screen.getByRole("button",{name:/Configure minimum/})).toBeInTheDocument());fireEvent.click(screen.getByRole("button",{name:/Configure minimum/}));
  fireEvent.click(screen.getByRole("button",{name:"Clear minimum"}));await waitFor(()=>expect(mocks.save).toHaveBeenLastCalledWith(product.id,null,row.version));
});
it("first set uses a null version and invalid quantities never dispatch",async()=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:[{...row,minimumQuantity:null,version:null,status:"NOT_CONFIGURED"}]});show();fireEvent.click(screen.getByRole("button",{name:/Configure minimum/}));
  fireEvent.change(screen.getByRole("textbox",{name:/Minimum for/}),{target:{value:"0"}});fireEvent.click(screen.getByRole("button",{name:"Save minimum"}));expect(screen.getByRole("alert")).toHaveTextContent("positive whole number");expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox",{name:/Minimum for/}),{target:{value:"5"}});fireEvent.click(screen.getByRole("button",{name:"Save minimum"}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(product.id,"5",null));
});
it("shows conflict guidance and blocks duplicate submissions while pending",async()=>{
  let finish!:(v:unknown)=>void;mocks.save.mockReturnValue(new Promise(resolve=>{finish=resolve;}));show();fireEvent.click(screen.getByRole("button",{name:/Configure minimum/}));
  fireEvent.click(screen.getByRole("button",{name:"Save minimum"}));fireEvent.click(screen.getByRole("button",{name:"Save minimum"}));expect(mocks.save).toHaveBeenCalledTimes(1);
  finish({ok:false,error:{message:"This minimum changed. Refresh and review."}});await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("minimum changed"));
  fireEvent.click(screen.getByRole("button",{name:"Refresh stock health"}));expect(mocks.refetch).toHaveBeenCalled();
});
it.each(["archived","permission"])("does not expose configuration for %s",state=>{
  mocks.hook.mockReturnValue({...mocks.hook(),canEdit:state!=="permission",rows:[{...row,isActive:state!=="archived"}]});show([{...product,isActive:state!=="archived"}]);expect(screen.queryByRole("button",{name:/Configure minimum/})).not.toBeInTheDocument();
});
it("removes open edit controls if edit permission is revoked",()=>{
  const view=show();fireEvent.click(screen.getByRole("button",{name:/Configure minimum/}));
  mocks.hook.mockReturnValue({...mocks.hook(),canEdit:false});
  view.rerender(<MemoryRouter><InventoryStockHealthProductList products={[product]} warehouseId={raw} warehouseCode="raw_materials" search="resistor" authorizedWarehouseIds={[raw]} showCommitments={false}/></MemoryRouter>);
  expect(screen.queryByRole("button",{name:"Save minimum"})).not.toBeInTheDocument();
});
it("filters authoritative rows while preserving Product order and search scope",()=>{
  const second={...product,id:"00000000-0000-4000-8000-000000000002",serialNumber:"000",name:"Second"};show([second,product]);
  expect(screen.getAllByRole("row").slice(1).map(r=>within(r).getByRole("rowheader").textContent)).toEqual(["000","001"]);
  fireEvent.change(screen.getByRole("combobox",{name:"Stock Health"}),{target:{value:"LOW_STOCK"}});
  expect(mocks.hook).toHaveBeenLastCalledWith(raw,"resistor","LOW_STOCK",true);expect(screen.queryByRole("link",{name:"Second"})).not.toBeInTheDocument();
});
it.each([true,false])("shows unavailable, never fabricated minimum/status, while fetching=%s",fetching=>{
  mocks.hook.mockReturnValue({...mocks.hook(),rows:undefined,query:{isFetching:fetching,refetch:mocks.refetch}});show();expect(screen.getAllByText("Unavailable")).toHaveLength(2);expect(screen.getByText("10")).toBeInTheDocument();expect(screen.queryByRole("button",{name:/Configure minimum/})).not.toBeInTheDocument();
});
