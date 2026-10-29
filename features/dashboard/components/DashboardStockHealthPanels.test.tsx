import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../hooks/useDashboardRawCatalog", () => ({
  useDashboardRawCatalog: (products: unknown[]) => ({ products, status: "ready", query: {} }),
}));
const mocks=vi.hoisted(()=>({hook:vi.fn(),gate:vi.fn(),retry:vi.fn()}));
vi.mock("../../../app/config/inventoryStockHealthActivation",()=>({isInventoryStockHealthEnabled:mocks.gate}));
vi.mock("../hooks/useDashboardStockHealth",()=>({useDashboardStockHealth:mocks.hook}));
import DashboardStockHealthPanels from "./DashboardStockHealthPanels";
import type { DashboardStockHealth } from "../services/dashboardStockHealthService";
const wh=(code:"raw_materials"|"customs"|"finished_goods",n:number)=>({warehouseId:`10000000-0000-4000-8000-00000000000${n}`,warehouseCode:code,warehouseName:code==="raw_materials"?"Raw Materials":code==="customs"?"Customs":"Finished Goods",productCount:"10",healthyCount:"6",lowStockCount:"2",outOfStockCount:"1",notConfiguredCount:"1"});
const raw=wh("raw_materials",1),fg=wh("finished_goods",2),customs=wh("customs",3);
const health:DashboardStockHealth={asOf:"2026-10-28T10:00:00Z",warehouses:[raw,fg,customs],criticalItems:[
  {productId:"p1",serialNumber:"001",productName:"Z out first",warehouseId:fg.warehouseId,warehouseCode:fg.warehouseCode,warehouseName:fg.warehouseName,physicalQuantity:"0",minimumQuantity:"9223372036854775807",version:"1",status:"OUT_OF_STOCK"},
  {productId:"p2",serialNumber:"002",productName:"A low second",warehouseId:raw.warehouseId,warehouseCode:raw.warehouseCode,warehouseName:raw.warehouseName,physicalQuantity:"9007199254740993",minimumQuantity:"9223372036854775807",version:"1",status:"LOW_STOCK"},
]};
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockReturnValue(true);mocks.hook.mockReturnValue({data:health,status:"ready",query:{refetch:mocks.retry}});});afterEach(cleanup);
const show=()=>render(<MemoryRouter><DashboardStockHealthPanels legacyInventory={null}/></MemoryRouter>);
it("OFF mounts no new hook and preserves legacy visibility",()=>{mocks.gate.mockReturnValue(false);const view=show();expect(view.container).toBeEmptyDOMElement();expect(mocks.hook).not.toHaveBeenCalled();});
it("charts three authorized warehouses in Raw/Customs/FG order with all four exact status counts",()=>{
  show();const bars=screen.getAllByRole("img");expect(bars.map(b=>b.getAttribute("aria-label"))).toEqual([raw,customs,fg].map(w=>`${w.warehouseName}: Healthy 6, Low Stock 2, Out of Stock 1, Not Configured 1`));
  expect(screen.getAllByText("10 Products")).toHaveLength(3);expect(screen.getAllByText("6",{selector:"dd"})).toHaveLength(3);
  expect(bars[0]!.children[0]).toHaveClass("bg-emerald-500");expect(bars[0]!.children[1]).toHaveClass("bg-amber-500");expect(bars[0]!.children[2]).toHaveClass("bg-red-500");expect(bars[0]!.children[3]).toHaveClass("bg-zinc-300");
  expect(bars[0]!.children[0]).toHaveStyle({width:"60.0000%"});
});
it("keeps critical priority, exact bigint values and warehouse-aware navigation",()=>{
  show();const table=screen.getByRole("table"),rows=within(table).getAllByRole("row").slice(1);
  expect(rows.map(r=>within(r).getByRole("link").textContent)).toEqual(["Z out first","A low second"]);
  expect(within(rows[1]!).getByText("9007199254740993")).toBeInTheDocument();expect(screen.getAllByText("9223372036854775807")).toHaveLength(2);
  expect(screen.getByRole("link",{name:"Z out first"})).toHaveAttribute("href","/inventory/p1?warehouse=finished_goods");
  expect(within(rows[0]!).getByText("Out of Stock")).toBeInTheDocument();expect(within(rows[1]!).getByText("Low Stock")).toBeInTheDocument();
});
it("omits unauthorized warehouses rather than showing them as zero",()=>{
  mocks.hook.mockReturnValue({...mocks.hook(),data:{...health,warehouses:[fg],criticalItems:[health.criticalItems[0]]}});show();expect(screen.queryByText("Raw Materials")).not.toBeInTheDocument();expect(screen.queryByText("Customs")).not.toBeInTheDocument();expect(screen.getAllByRole("img")).toHaveLength(1);
});
it("keeps authorized recent catalog content, but never exposes it to an FG-only viewer",()=>{
  const legacy={activeProductCount:1,recent:[{productId:"catalog",serialNumber:"003",name:"Existing catalog update",category:"Components",quantity:"4",updatedAt:"2026-10-28T10:00:00Z"}]};
  const view=render(<MemoryRouter><DashboardStockHealthPanels legacyInventory={legacy}/></MemoryRouter>);
  expect(screen.getByRole("link",{name:"Existing catalog update"})).toBeInTheDocument();
  mocks.hook.mockReturnValue({...mocks.hook(),data:{...health,warehouses:[fg],criticalItems:[health.criticalItems[0]]}});
  view.rerender(<MemoryRouter><DashboardStockHealthPanels legacyInventory={legacy}/></MemoryRouter>);
  expect(screen.queryByRole("link",{name:"Existing catalog update"})).not.toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Z out first"})).toBeInTheDocument();
});
it("shows real zero-product empty state and no invented critical items",()=>{
  mocks.hook.mockReturnValue({...mocks.hook(),data:{...health,warehouses:[{...raw,productCount:"0",healthyCount:"0",lowStockCount:"0",outOfStockCount:"0",notConfiguredCount:"0"}],criticalItems:[]}});show();expect(screen.getByText("0 Products")).toBeInTheDocument();expect(screen.getByText("No active Products in this warehouse.")).toBeInTheDocument();expect(screen.queryByRole("img")).not.toBeInTheDocument();expect(screen.getByText("No configured Products need stock attention.")).toBeInTheDocument();
});
it.each(["loading","error","denied"])("distinguishes %s without stale/fabricated values",status=>{
  mocks.hook.mockReturnValue({data:undefined,status,query:{refetch:mocks.retry}});const view=show();expect(screen.queryByRole("table")).not.toBeInTheDocument();expect(screen.queryByText("10 Products")).not.toBeInTheDocument();
  if(status==="denied")expect(view.container).toBeEmptyDOMElement();else expect(screen.getByRole(status==="error"?"alert":"status")).toBeInTheDocument();
  if(status==="error"){fireEvent.click(screen.getByRole("button",{name:"Retry stock health"}));expect(mocks.retry).toHaveBeenCalled();}
});
it("preserves bigint Product counts in text and uses bounded ratios only for layout",()=>{
  mocks.hook.mockReturnValue({...mocks.hook(),data:{...health,warehouses:[{...raw,productCount:"9007199254740993",healthyCount:"9007199254740993",lowStockCount:"0",outOfStockCount:"0",notConfiguredCount:"0"}],criticalItems:[]}});show();expect(screen.getByText("9007199254740993 Products")).toBeInTheDocument();expect(screen.getByRole("img").children[0]).toHaveStyle({width:"100.0000%"});
});
