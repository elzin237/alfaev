import { Link } from "react-router";
import StatusBadge from "../../../shared/components/StatusBadge";
import type { DashboardStockHealth } from "../services/dashboardStockHealthService";

export default function DashboardCriticalInventoryTable({health}:{health:DashboardStockHealth}){
  if(health.criticalItems.length===0)return <div className="rounded-lg bg-zinc-50 px-4 py-6 text-sm text-zinc-600">
    <p className="font-semibold text-zinc-800">No configured Products need stock attention.</p>
    <p className="mt-1 text-xs">Unconfigured minimums are shown separately in Stock Health, not classified as healthy.</p>
  </div>;
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
