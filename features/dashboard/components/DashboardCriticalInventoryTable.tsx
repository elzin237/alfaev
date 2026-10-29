import { Link } from "react-router";
import StatusBadge from "../../../shared/components/StatusBadge";
import type { DashboardStockHealth } from "../services/dashboardStockHealthService";

export default function DashboardCriticalInventoryTable({health,compact=false}:{health:DashboardStockHealth;compact?:boolean}){
  if(compact && health.criticalItems.length===0)return <details className="rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-600"><summary className="cursor-pointer rounded font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-red-500">No configured Products need stock attention.</summary><p className="mt-2 leading-5">Unconfigured minimums are shown separately in Stock Health, not classified as healthy.</p></details>;
  if(health.criticalItems.length===0)return <div className={compact ? "rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600" : "rounded-lg bg-zinc-50 px-4 py-6 text-sm text-zinc-600"}>
    <p className="font-semibold text-zinc-800">No configured Products need stock attention.</p>
    <p className="mt-1 text-xs">Unconfigured minimums are shown separately in Stock Health, not classified as healthy.</p>
  </div>;
  if(compact)return <ul className="divide-y divide-zinc-100">{health.criticalItems.map(item=><li key={`${item.warehouseId}:${item.productId}`} className="space-y-2 py-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><Link className="break-words rounded text-xs font-semibold text-zinc-900 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-300" to={`/inventory/${item.productId}?warehouse=${item.warehouseCode}`}>{item.productName}</Link><p className="mt-1 text-[11px] text-zinc-500">{item.warehouseName} · <span className="font-mono">{item.serialNumber}</span></p></div><StatusBadge label={item.status==="OUT_OF_STOCK"?"Out of Stock":"Low Stock"} tone={item.status==="OUT_OF_STOCK"?"danger":"warning"}/></div>
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-zinc-50 p-2 text-xs"><div><dt className="text-zinc-500">Physical Stock</dt><dd className="mt-1 break-all font-semibold text-red-700 tabular-nums">{item.physicalQuantity}</dd></div><div><dt className="text-zinc-500">Minimum Stock</dt><dd className="mt-1 break-all font-semibold text-zinc-800 tabular-nums">{item.minimumQuantity}</dd></div></dl>
  </li>)}</ul>;
  return <div className="overflow-x-auto rounded-md border border-zinc-100">
    <table className="w-full text-left text-xs"><thead className="bg-slate-50 text-zinc-500"><tr>
      {["Product","Warehouse","Physical Stock","Minimum Stock","Stock Health"].map(label=><th key={label} scope="col" className="px-3 py-2 font-semibold">{label}</th>)}
    </tr></thead><tbody className="divide-y divide-zinc-100">
      {health.criticalItems.map(item=><tr key={`${item.warehouseId}:${item.productId}`}>
        <td className="min-w-36 max-w-64 break-words px-3 py-3 font-semibold text-zinc-900">
          <Link className="rounded-sm underline-offset-4 hover:text-red-700 hover:underline focus-visible:ring-2 focus-visible:ring-red-300"
            to={`/inventory/${item.productId}?warehouse=${item.warehouseCode}`}>{item.productName}</Link>
          <span className="mt-1 block font-mono text-[11px] font-normal text-zinc-500">{item.serialNumber}</span>
        </td>
        <td className="px-3 py-3 text-zinc-600">{item.warehouseName}</td>
        <td className="whitespace-nowrap px-3 py-3 font-semibold tabular-nums text-red-700">{item.physicalQuantity}</td>
        <td className="whitespace-nowrap px-3 py-3 tabular-nums">{item.minimumQuantity}</td>
        <td className="whitespace-nowrap px-3 py-3"><StatusBadge label={item.status==="OUT_OF_STOCK"?"Out of Stock":"Low Stock"} tone={item.status==="OUT_OF_STOCK"?"danger":"warning"}/></td>
      </tr>)}
    </tbody></table>
  </div>;
}
