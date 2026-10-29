import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import StatusBadge from "../../../shared/components/StatusBadge";
import { useInventoryStockHealth } from "../hooks/useInventoryStockHealth";
import InventoryStockMinimumEditor from "./InventoryStockMinimumEditor";

interface Props {
  productId: string;
  serialNumber: string;
  productIsActive: boolean;
  warehouseId: string;
}

function ActivatedStockHealth({ productId, serialNumber, productIsActive, warehouseId }: Props) {
  // The parent only renders this for an authorized warehouse detail. Search bounds
  // the existing trusted read; exact pair matching prevents another row being used.
  const { rows, query, allowed, canEdit, save } = useInventoryStockHealth(warehouseId, serialNumber, null, true);
  const row = rows?.find(item => item.productId === productId && item.warehouseId === warehouseId);
  return <div className="mt-5 border-t border-zinc-200 pt-4">
    <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Minimum Stock</h3>
        <div className="mt-3 text-sm text-zinc-900">
          {row ? <InventoryStockMinimumEditor key={`${warehouseId}:${productId}:${row.version ?? "new"}`}
            row={row} canEdit={canEdit && productIsActive} save={save} /> : "Unavailable"}
        </div>
      </div>
      <div className="min-w-0 space-y-3 sm:border-l sm:border-zinc-200 sm:pl-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Stock Health</h3>
        {row ? <StatusBadge label={{ HEALTHY: "Healthy", LOW_STOCK: "Low Stock", OUT_OF_STOCK: "Out of Stock", NOT_CONFIGURED: "Not Configured" }[row.status]}
          tone={row.status === "HEALTHY" ? "success" : row.status === "LOW_STOCK" ? "warning" : row.status === "OUT_OF_STOCK" ? "danger" : "neutral"} /> : <span className="text-sm">Unavailable</span>}
        {allowed && <button type="button" className="block rounded-md py-1 text-xs font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh stock health</button>}
      </div>
    </div>
    {!row && <p role={query.isFetching ? "status" : "alert"} className="mt-3 text-sm text-zinc-600">
      {query.isFetching ? "Loading stock health…" : query.data?.ok === false ? query.data.error.message : "Stock health could not be verified. Refresh before configuring a minimum."}
    </p>}
  </div>;
}

export default function ProductStockHealthSection(props: Props) {
  return isInventoryStockHealthEnabled() ? <ActivatedStockHealth {...props} /> : null;
}
