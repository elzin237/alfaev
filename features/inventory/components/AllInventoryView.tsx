import { useId, useRef, useState } from "react";
import { Link } from "react-router";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import { useAllInventory, type AllInventoryRow } from "../hooks/useAllInventory";
import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";

const healthLabels = { HEALTHY: "Healthy", LOW_STOCK: "Low Stock", OUT_OF_STOCK: "Out of Stock", NOT_CONFIGURED: "Not Configured" };
const identityWidths = ["w-22 min-w-22 max-w-22", "w-28 min-w-28 max-w-28", "w-56 min-w-56 max-w-56"];
function pinnedBodyColumn(column: number) {
  if (column === 0) return "sticky left-0 z-10 border-r border-zinc-200 bg-white";
  if (column === 1) return "sticky left-22 z-10 border-r border-zinc-200 bg-white shadow-[2px_0_3px_-2px_#a1a1aa] md:shadow-none";
  if (column === 2) return "bg-white md:sticky md:left-50 md:z-10 md:border-r md:border-zinc-200 md:shadow-[2px_0_3px_-2px_#a1a1aa]";
  return "";
}
export function AllInventoryTable({ rows, testsEnabled }: { rows: AllInventoryRow[]; testsEnabled: boolean }) {
  const scrollHelpId = useId();
  const healthEnabled = isInventoryStockHealthEnabled();
  const headings = ["Warehouse", "Serial Number", "Product", "Category", "Brand", "Physical Stock", "Outstanding Project Demand (Raw)", "Reserved to Projects (FG)", "Available After Demand (Raw + Customs)", "Available FG",
    ...(testsEnabled ? ["Committed to Tests", "Available After Projects and Tests"] : []), ...(healthEnabled ? ["Minimum Stock", "Stock Health"] : []), "Status"];
  return <div className="space-y-2">
    <p id={scrollHelpId} className="text-xs text-zinc-500">Scroll inside the table for more rows and columns. Focus the results area to use arrow keys or Page Up / Page Down.</p>
    <div role="region" aria-label="All Inventory results" aria-describedby={scrollHelpId} tabIndex={0}
      className="isolate max-h-[min(34rem,70dvh)] overflow-auto overscroll-contain scroll-pt-12 rounded-2xl border border-zinc-200 bg-white [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500">
    <table className="min-w-full border-separate border-spacing-0">
    <colgroup><col className="w-22" /><col className="w-28" /><col className="w-56" /><col span={headings.length - 3} /></colgroup>
    <caption className="sr-only">All authorized Inventory, one row per Product and warehouse</caption>
    <thead><tr className="h-12">{headings.map((h, index) => <th key={h} scope="col"
      className={`sticky top-0 h-12 border-b border-zinc-200 bg-zinc-50 text-left text-xs font-semibold whitespace-nowrap uppercase ${index === 0 ? "px-2" : "px-3"} py-2 ${identityWidths[index] ?? ""} ${index === 0 ? "left-0 z-40 border-r" : index === 1 ? "left-22 z-40 border-r" : index === 2 ? "z-30 md:left-50 md:z-40 md:border-r" : "z-20"} ${h === "Committed to Tests" ? "text-blue-700" : "text-zinc-500"}`}>{h}</th>)}</tr></thead>
    <tbody>{rows.map(({ warehouse, product, commitment, test, health }) => {
      const raw = warehouse.code === "raw_materials", fg = warehouse.code === "finished_goods";
      const cells = [product.serialNumber, <Link to={`/inventory/${product.id}?warehouse=${warehouse.code}`} title={product.name} className="block w-50 truncate font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-red-500">{product.name}</Link>, product.category, product.brandName ?? "—", product.quantity.toString(),
        raw ? commitment?.committedToProjects.toString() ?? "Unavailable" : "—", fg ? commitment?.committedToProjects.toString() ?? "Unavailable" : "—",
        raw ? commitment?.availableAfterCommitments.toString() ?? "Unavailable" : "—", fg ? commitment?.availableAfterCommitments.toString() ?? "Unavailable" : "—",
        ...(testsEnabled ? [test?.committedToTests ?? "Unavailable", test?.availableAfterProjectsAndTests ?? "Unavailable"] : []),
        ...(healthEnabled ? [health ? health.minimumQuantity ?? "Not Configured" : "Unavailable", health ? <StatusBadge label={healthLabels[health.status]} tone={health.status === "HEALTHY" ? "success" : health.status === "LOW_STOCK" ? "warning" : health.status === "OUT_OF_STOCK" ? "danger" : "neutral"} /> : "Unavailable"] : []), <StatusBadge label={product.isActive ? "Active" : "Archived"} tone={product.isActive ? "success" : "neutral"} />];
      return <tr key={`${warehouse.id}:${product.id}`} className="h-12 text-sm text-zinc-700"><th scope="row" className={`h-12 border-b border-zinc-200 px-2 py-2 text-left ${identityWidths[0]} ${pinnedBodyColumn(0)}`}><abbr title={warehouse.label} aria-label={warehouse.label} className="rounded-md bg-zinc-100 px-2 py-1 no-underline">{{raw_materials:"R",finished_goods:"F",customs:"C"}[warehouse.code]}</abbr></th>
        {cells.map((value, i) => <td key={headings[i + 1]} className={`h-12 border-b border-zinc-200 px-3 py-2 whitespace-nowrap tabular-nums ${identityWidths[i + 1] ?? ""} ${pinnedBodyColumn(i + 1)} ${headings[i + 1] === "Committed to Tests" ? "font-semibold text-blue-700" : typeof value === "string" && /^-[1-9]/.test(value) ? "font-semibold text-red-700" : ""}`}>{value}</td>)}</tr>;
    })}</tbody></table></div></div>;
}
export default function AllInventoryView({ authorizedWarehouseIds, search, testsEnabled }: { authorizedWarehouseIds: readonly string[]; search: string; testsEnabled: boolean }) {
  const [warehouseChoice, setWarehouse] = useState("all"), [lifecycle, setLifecycle] = useState("all"), [health, setHealth] = useState("all"), [pageState, setPage] = useState({ scope: "", page: 0 }), [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState(false);
  const warehouse = INVENTORY_WAREHOUSES.some(w => w.code === warehouseChoice && authorizedWarehouseIds.includes(w.id)) ? warehouseChoice : "all";
  const lock = useRef(false), data = useAllInventory(authorizedWarehouseIds, search, warehouse, testsEnabled);
  const scope = `${authorizedWarehouseIds.join()}:${search}:${warehouse}:${lifecycle}:${health}`;
  const filtered = data.rows.filter(row => (lifecycle === "all" || row.product.isActive === (lifecycle === "active")) && (health === "all" || row.health?.status === health));
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), page = Math.min(scope === pageState.scope ? pageState.page : 0, pages - 1);
  async function refresh() { if (lock.current) return; lock.current = true; setRefreshing(true); setRefreshError(false); try { await data.refresh(); } catch { setRefreshError(true); } finally { lock.current = false; setRefreshing(false); } }
  if (!data.active || !authorizedWarehouseIds.length) return <ErrorState title="Access denied" message="You do not have permission to view any Inventory warehouse." />;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label>Warehouse <select value={warehouse} onChange={e => setWarehouse(e.target.value)} className="rounded-lg border p-2"><option value="all">All authorized warehouses</option>{INVENTORY_WAREHOUSES.filter(w => authorizedWarehouseIds.includes(w.id)).map(w => <option key={w.id} value={w.code}>{{raw_materials:"R",finished_goods:"F",customs:"C"}[w.code]} — {w.label}</option>)}</select></label>
      <label>Product status <select value={lifecycle} onChange={e => setLifecycle(e.target.value)} className="rounded-lg border p-2"><option value="all">Active and archived</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
      {isInventoryStockHealthEnabled() && <label>Stock Health <select value={health} onChange={e => setHealth(e.target.value)} className="rounded-lg border p-2"><option value="all">All</option>{Object.entries(healthLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
      <button type="button" disabled={refreshing || data.pending} className="underline" onClick={() => void refresh()}>Refresh All Inventory</button>
    </div>
    <p className="text-sm text-zinc-500">Quantities are warehouse-specific, never added together. Raw planning and Raw Test columns cover Raw + Customs; FG reservations and Customs Test holds keep their separate scopes. “—” means not applicable; “Unavailable” means unverified. Reads across warehouses are not an atomic stock snapshot.</p>
    {refreshError && <p role="alert">All Inventory could not be refreshed. Retry before relying on unverified figures.</p>}
    {data.pending ? <LoadingState message="Loading complete authorized Inventory…" /> : data.failure ? <ErrorState title="Unable to load All Inventory" message={data.failure} onRetry={() => void refresh()} /> : health !== "all" && !data.healthReady ? <ErrorState title="Stock health unavailable" message="Filtered results require successful authorized stock-health reads." onRetry={() => void refresh()} /> : filtered.length === 0 ? <p role="status">No Products match the authorized Inventory filters.</p> : <>
      <AllInventoryTable rows={filtered.slice(page * 50, page * 50 + 50)} testsEnabled={testsEnabled} />
      <nav aria-label="All Inventory pages" className="flex items-center gap-4"><button disabled={page === 0} onClick={() => setPage({ scope, page: page - 1 })}>Previous</button><span>Page {page + 1} of {pages} · {filtered.length} Product/warehouse rows</span><button disabled={page + 1 >= pages} onClick={() => setPage({ scope, page: page + 1 })}>Next</button></nav>
    </>}
  </div>;
}
