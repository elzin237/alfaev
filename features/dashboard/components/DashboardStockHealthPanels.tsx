import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import { useDashboardStockHealth } from "../hooks/useDashboardStockHealth";
import type { DashboardInventorySection } from "../services/dashboardService";
import DashboardInventory from "./DashboardInventory";
import DashboardWarehouseOverview from "./DashboardWarehouseOverview";
import DashboardInventoryHealth from "./DashboardInventoryHealth";

interface PanelProps { legacyInventory: DashboardInventorySection | null; unified?: boolean; renderPanels?: (overview: ReactNode, attention: ReactNode) => ReactNode }
function panels(props: PanelProps, overview: ReactNode, attention: ReactNode, inventoryTo = "/inventory") {
  if (props.unified) {
    const unified = <DashboardInventoryHealth overview={overview} attention={attention} inventoryTo={inventoryTo} />;
    return props.renderPanels ? props.renderPanels(unified, null) : unified;
  }
  return props.renderPanels ? props.renderPanels(overview, attention) : <div className="grid items-stretch gap-4 @4xl:grid-cols-[1.3fr_1fr]">{overview}{attention}</div>;
}
function ActivatedPanels(props: PanelProps){
  const {legacyInventory}=props;
  const {query,data,status}=useDashboardStockHealth();
  if(status==="denied")return props.renderPanels?.(null,null) ?? null;
  if(status!=="ready"||!data)return panels(props, <section role={status==="error"?"alert":"status"}
    aria-label="Warehouse stock health" className={props.unified ? "px-4 pb-4" : "rounded-xl border border-zinc-200/70 bg-white p-5 shadow-sm"}>
    {!props.unified && <h2 className="text-sm font-semibold text-zinc-900">Warehouse Stock Health</h2>}
    <p className="mt-2 text-sm text-zinc-500">{status==="error"?"Stock health is unavailable. No Product counts or minimum-stock values are assumed.":"Loading authorized warehouse stock health…"}</p>
    {status==="error"&&<button type="button" className="mt-3 text-sm font-semibold text-red-700 underline" onClick={()=>void query.refetch()}>Retry stock health</button>}
  </section>, null);
  if(data.warehouses.length===0)return props.renderPanels?.(null,null) ?? null;
  return panels(props, <DashboardWarehouseOverview health={data} embedded={props.unified}/>, <DashboardInventory compact={Boolean(props.renderPanels) || props.unified} embedded={props.unified} section={data.warehouses.some(w=>w.warehouseCode==="raw_materials")?legacyInventory:null} stockHealth={data}/>, `/inventory?warehouse=${data.warehouses[0]!.warehouseCode}`);
}
export default function DashboardStockHealthPanels(props: PanelProps){
  if(isInventoryStockHealthEnabled())return <ActivatedPanels {...props}/>;
  if(props.legacyInventory===null)return props.renderPanels?.(null,null) ?? null;
  return panels(props, <DashboardWarehouseOverview embedded={props.unified}/>, <DashboardInventory compact={Boolean(props.renderPanels) || props.unified} embedded={props.unified} section={props.legacyInventory}/>);
}
import type { ReactNode } from "react";
