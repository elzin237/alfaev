import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import { useDashboardStockHealth } from "../hooks/useDashboardStockHealth";
import type { DashboardInventorySection } from "../services/dashboardService";
import DashboardInventory from "./DashboardInventory";
import DashboardWarehouseOverview from "./DashboardWarehouseOverview";

function ActivatedPanels({legacyInventory}:{legacyInventory:DashboardInventorySection|null}){
  const {query,data,status}=useDashboardStockHealth();
  if(status==="denied")return null;
  if(status!=="ready"||!data)return <section role={status==="error"?"alert":"status"}
    aria-label="Warehouse stock health" className="rounded-xl border border-zinc-200/70 bg-white p-5 shadow-sm">
    <h2 className="text-sm font-semibold text-zinc-900">Warehouse Stock Health</h2>
    <p className="mt-2 text-sm text-zinc-500">{status==="error"?"Stock health is unavailable. No Product counts or minimum-stock values are assumed.":"Loading authorized warehouse stock health…"}</p>
    {status==="error"&&<button type="button" className="mt-3 text-sm font-semibold text-red-700 underline" onClick={()=>void query.refetch()}>Retry stock health</button>}
  </section>;
  return <div className="grid items-stretch gap-4 @4xl:grid-cols-[1.3fr_1fr]">
    <DashboardWarehouseOverview health={data}/><DashboardInventory section={data.warehouses.some(w=>w.warehouseCode==="raw_materials")?legacyInventory:null} stockHealth={data}/>
  </div>;
}
export default function DashboardStockHealthPanels({legacyInventory}:{legacyInventory:DashboardInventorySection|null}){
  if(isInventoryStockHealthEnabled())return <ActivatedPanels legacyInventory={legacyInventory}/>;
  if(legacyInventory===null)return null;
  return <div className="grid items-stretch gap-4 @4xl:grid-cols-[1.3fr_1fr]">
    <DashboardWarehouseOverview/><DashboardInventory section={legacyInventory}/>
  </div>;
}
