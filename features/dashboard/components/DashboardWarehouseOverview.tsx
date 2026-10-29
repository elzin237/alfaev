import { Warehouse } from "lucide-react";
import DashboardSectionHeader from "./DashboardSectionHeader";
import { Link } from "react-router";
import type { DashboardStockHealth } from "../services/dashboardStockHealthService";

const segments=[
  {key:"healthyCount",label:"Healthy",color:"bg-emerald-500"},
  {key:"lowStockCount",label:"Low Stock",color:"bg-amber-500"},
  {key:"outOfStockCount",label:"Out of Stock",color:"bg-red-500"},
  {key:"notConfiguredCount",label:"Not Configured",color:"bg-zinc-300"},
] as const;
// Each warehouse's composition uses bigint arithmetic. Percent strings are layout only;
// all displayed counts remain exact authoritative decimal text.
function width(count:string,maximum:bigint){
  const scaled=maximum===0n?0n:BigInt(count)*1_000_000n/maximum;
  return `${scaled/10_000n}.${(scaled%10_000n).toString().padStart(4,"0")}%`;
}
function StockHealthChart({health,embedded=false}:{health:DashboardStockHealth;embedded?:boolean}){
  const rows=["raw_materials","finished_goods","customs"].flatMap(code=>health.warehouses.filter(w=>w.warehouseCode===code));
  return <section aria-labelledby="dashboard-warehouses-title" className={`@container/stock flex min-h-0 min-w-0 flex-col ${embedded ? "" : "overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"}`}>
    {embedded ? <h3 id="dashboard-warehouses-title" className="px-4 py-3 text-xs font-semibold text-zinc-700">Warehouse Overview</h3> : <DashboardSectionHeader icon={Warehouse} title="Warehouse Stock Health" titleId="dashboard-warehouses-title"
      actionLabel="View inventory" actionTo={`/inventory?warehouse=${rows[0]!.warehouseCode}`} />}
    <div role="region" aria-label="Warehouse Stock Health content" tabIndex={0} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 focus-visible:outline-2 focus-visible:outline-red-500">
      <p className="text-xs text-zinc-500">Active Product/warehouse pairs, not stock units. A Product can belong to multiple warehouses.</p>
      <div className={`grid gap-3 ${embedded ? "@md/stock:grid-cols-3" : "@2xl/stock:grid-cols-3"}`}>{rows.map(row=><div key={row.warehouseId} className="min-w-0 space-y-3 rounded-lg border border-zinc-200/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <Link to={`/inventory?warehouse=${row.warehouseCode}`} className="font-semibold text-zinc-800 underline-offset-4 hover:underline">{row.warehouseCode==="customs"?"Customs Warehouse":row.warehouseName}</Link>
          <span className="break-all tabular-nums text-zinc-500">{row.productCount} Products</span>
        </div>
        {row.productCount==="0"?<p className="rounded-lg bg-zinc-50 px-3 py-3 text-xs text-zinc-500">No active Products in this warehouse.</p>:<>
          <div role="img" aria-label={`${row.warehouseName}: ${segments.map(s=>`${s.label} ${row[s.key]}`).join(", ")}`}
            className={`flex ${embedded ? "h-6" : "h-8"} overflow-hidden rounded-md bg-zinc-50`}>
            {segments.map(s=><span key={s.key} aria-hidden="true" className={`h-full shrink-0 ${s.color}`} style={{width:width(row[s.key],BigInt(row.productCount))}} />)}
          </div>
          <dl className="space-y-2 text-[11px]">
            {segments.map(s=><div key={s.key} className="flex min-w-0 justify-between gap-2"><dt className="flex items-center gap-1.5 text-zinc-500"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${s.color}`}/>{s.label}</dt><dd className="break-all text-right font-semibold tabular-nums text-zinc-800">{row[s.key]}</dd></div>)}
          </dl>
        </>}
      </div>)}</div>
      <p className="text-[11px] text-zinc-400">Verified as of <time dateTime={health.asOf}>{health.asOf}</time>.</p>
    </div>
  </section>;
}

/** No warehouse counts are present in the legacy Dashboard read contract. */
export default function DashboardWarehouseOverview({health,embedded=false}:{health?:DashboardStockHealth;embedded?:boolean}={}) {
  if(health?.warehouses.length===0)return null;
  if(health)return <StockHealthChart health={health} embedded={embedded}/>;
  return <section aria-labelledby="dashboard-warehouses-title" className={`flex min-h-0 min-w-0 flex-col ${embedded ? "" : "overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"}`}>
    {embedded ? <h3 id="dashboard-warehouses-title" className="px-4 py-3 text-xs font-semibold text-zinc-700">Warehouse Overview</h3> : <DashboardSectionHeader icon={Warehouse} title="Warehouse Stock Overview" titleId="dashboard-warehouses-title"
      actionLabel="View inventory" actionTo="/inventory" />}
    <div role="region" aria-label="Warehouse Stock Overview content" tabIndex={0} className="min-h-0 flex-1 overflow-auto px-4 pb-4 focus-visible:outline-2 focus-visible:outline-red-500">
      <p className="mb-4 text-xs text-zinc-500">Product counts by physical stock, not quantities across Products.</p>
      <div className="space-y-4" aria-label="Warehouse count availability">
        {["Raw Materials", "Customs", "Finished Goods"].map(name => <div key={name} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
          <span className="text-right text-xs font-semibold text-zinc-700">{name}</span>
          <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">Counts unavailable</div>
        </div>)}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-600">
        <span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-full bg-emerald-500" />Positive physical stock</span>
        <span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-full bg-red-500" />Zero physical stock</span>
      </div>
      <p className="mt-3 text-[11px] leading-4 text-zinc-500">Awaiting authorized warehouse reads. No minimum-stock thresholds or estimated counts.</p>
    </div>
  </section>;
}
