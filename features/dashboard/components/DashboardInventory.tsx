import { Package } from "lucide-react";
import { Link } from "react-router";

import type { DashboardInventorySection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardCriticalInventoryTable from "./DashboardCriticalInventoryTable";
import type { DashboardStockHealth } from "../services/dashboardStockHealthService";
import { useDashboardRawCatalog } from "../hooks/useDashboardRawCatalog";

export interface DashboardInventoryProps {
  section: DashboardInventorySection | null;
  stockHealth?: DashboardStockHealth;
  compact?: boolean;
  embedded?: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function RawCatalog({ section }: { section: DashboardInventorySection }) {
  const { products, status, query } = useDashboardRawCatalog(section.recent);
  if (status === "denied") return null;
  return <div className="border-t border-zinc-100 px-4 py-3">
    <h3 className="text-[11px] font-semibold text-zinc-500">Recent catalog updates · Raw Materials</h3>
    {status !== "ready" || !products ? <div role={status === "error" ? "alert" : "status"} className="py-3 text-xs text-zinc-500">
      {status === "error" ? "Raw catalog membership is unavailable. No warehouse membership or stock is assumed." : "Verifying Raw Materials catalog…"}
      {status === "error" && <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>Retry Raw catalog</button>}
    </div> : products.length === 0 ? <p className="py-3 text-xs text-zinc-500">No active Raw Materials Products in the recent catalog window.</p> : <ul className="divide-y divide-zinc-100">
      {products.map(product => <li key={product.productId} className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2 text-xs">
        <div className="min-w-0 flex-1 basis-36">
          <Link to={`/inventory/${product.productId}?warehouse=raw_materials`}
            className="break-words rounded-sm font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2">{product.name}</Link>
          <p className="mt-0.5 break-words text-xs text-zinc-500"><span className="font-mono font-medium text-zinc-700">{product.serialNumber}</span><span aria-hidden="true"> · </span>{product.category}</p>
        </div>
        <dl className="min-w-0 max-w-full text-xs sm:text-right"><dt className="text-zinc-500">Raw physical quantity</dt><dd className="mt-0.5 break-all font-semibold tabular-nums text-zinc-900">{product.quantity}</dd></dl>
        <p className="w-full text-[10px] text-zinc-400"><span className="mr-1 font-medium text-zinc-700">Product updated</span><time dateTime={product.updatedAt}>{dateTimeFormatter.format(new Date(product.updatedAt))}</time></p>
      </li>)}
    </ul>}
  </div>;
}

function DashboardInventory({ section, stockHealth, compact = false, embedded = false }: DashboardInventoryProps) {
  if(stockHealth?.warehouses.length===0)return null;
  if (section === null && !stockHealth) return null;

  return (
    <section
      aria-labelledby="dashboard-inventory-title"
      className={compact ? "flex min-h-0 min-w-0 flex-col" : "h-full min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"}
    >
      {embedded ? <h3 id="dashboard-inventory-title" className="px-4 py-3 text-xs font-semibold text-zinc-700">{stockHealth ? "Critical Items" : "Inventory Attention"}</h3> : <DashboardSectionHeader
        actionLabel="View all inventory"
        actionTo={stockHealth ? `/inventory?warehouse=${stockHealth.warehouses[0]!.warehouseCode}` : "/inventory"}
        icon={Package}
        title={stockHealth ? "Critical Inventory Items" : "Inventory Attention"}
        titleId="dashboard-inventory-title"
        compact={compact}
      />}

      <div role="region" aria-label="Inventory attention content" tabIndex={0} className={`${embedded ? "max-h-96" : ""} min-h-0 flex-1 overflow-auto focus-visible:outline-2 focus-visible:outline-red-500`}>
      <div className="px-4 pb-3">
        {stockHealth ? <DashboardCriticalInventoryTable health={stockHealth} compact={compact}/> : <>
        <h3 className="mb-2 text-xs text-zinc-500">Project-demand attention</h3>
        <div className="overflow-x-auto rounded-md border border-zinc-100">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-50 text-zinc-500"><tr>{["Product", "Physical", "Shared deficit", "Status"].map(label => <th key={label} scope="col" className="px-3 py-2 font-semibold">{label}</th>)}</tr></thead>
            <tbody><tr><td colSpan={4} className="px-3 py-5 text-center leading-5 text-zinc-500">Project-demand deficits are unavailable in the current Dashboard read.<br />No urgency or minimum-stock status is inferred.</td></tr></tbody>
          </table>
        </div>
        </>}
      </div>

      {section && (compact ? <details className="border-t border-zinc-100 text-[11px] text-zinc-500"><summary className="cursor-pointer rounded px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-red-500">Recent Raw Materials catalog updates</summary><RawCatalog section={section} /></details> : <RawCatalog section={section} />)}
      </div>
    </section>
  );
}

export default DashboardInventory;
