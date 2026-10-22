import ErrorState from "../../../shared/components/ErrorState";
import EmptyState from "../../../shared/components/EmptyState";
import LoadingState from "../../../shared/components/LoadingState";
import { useInventorySourceLots } from "../hooks/useInventorySources";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default function SupplierStockHistorySection({ productId, warehouseId = "10000000-0000-4000-8000-000000000001" }: { productId: string; warehouseId?: string }) {
  const query = useInventorySourceLots(productId, warehouseId);
  const lots = query.data?.ok ? query.data.value : [];
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-bold text-zinc-900">Supplier Stock History</h2>
      <p className="mt-1 text-sm text-zinc-500">Immutable receipt provenance and remaining physical stock by source.</p>
      <div className="mt-6">
        {query.isPending ? <LoadingState message="Loading Supplier Stock History..." />
          : query.isError || !query.data?.ok ? (
            <ErrorState title="Unable to load Supplier Stock History" message={query.data?.ok === false ? query.data.error.message : "Supplier Stock History could not be loaded."} onRetry={() => void query.refetch()} />
          ) : lots.length === 0 ? (
            <EmptyState
              title="No source lots"
              description="No received or internally produced stock has been recorded for this Product."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-zinc-200">
              <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500"><tr>
                  {['Date','Supplier','Catalog Number','Description','Received Quantity','Remaining Quantity','Added By'].map((heading) => <th key={heading} scope="col" className="px-4 py-3">{heading}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {lots.map((lot) => <tr key={lot.id}>
                    <td className="px-4 py-4 text-zinc-700">{dateFormatter.format(new Date(lot.receivedAt))}</td>
                    <td className="px-4 py-4 font-semibold text-zinc-900">{lot.supplierName}</td>
                    <td className="px-4 py-4 font-mono text-zinc-700">{lot.catalogNumber ?? "—"}</td>
                    <td className="px-4 py-4 text-zinc-700">{lot.description ?? "—"}</td>
                    <td className="px-4 py-4 tabular-nums text-zinc-700">{lot.receivedQuantity.toString()}</td>
                    <td className="px-4 py-4 tabular-nums text-zinc-700">{lot.remainingQuantity.toString()}</td>
                    <td className="px-4 py-4 text-zinc-700">{lot.addedBy ?? "—"}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </section>
  );
}
