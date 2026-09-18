import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { usePcbProductionHistory } from "../hooks/usePcbProductionHistory";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default function PcbProductionHistory({ cardId }: { cardId: string }) {
  const historyQuery = usePcbProductionHistory(cardId);

  let content;
  if (historyQuery.isPending) {
    content = <LoadingState message="Loading PCB production history..." />;
  } else if (historyQuery.isError || !historyQuery.data?.ok) {
    content = <ErrorState title="Unable to load production history"
      message={historyQuery.data?.ok === false
        ? historyQuery.data.error.message : "PCB production history could not be loaded."}
      onRetry={() => void historyQuery.refetch()} />;
  } else if (historyQuery.data.value.length === 0) {
    content = <EmptyState title="No production history yet."
      description="Completed PCB production runs will appear here." />;
  } else {
    content = <div className="overflow-x-auto rounded-2xl border border-zinc-200">
      <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
        <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <tr>
            <th scope="col" className="px-5 py-4">Date</th>
            <th scope="col" className="px-5 py-4">Quantity</th>
            <th scope="col" className="px-5 py-4">Project</th>
            <th scope="col" className="px-5 py-4">BOM Version</th>
            <th scope="col" className="px-5 py-4">Produced By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {historyQuery.data.value.map((run) => <tr key={run.productionRunId} className="text-zinc-700">
            <td className="whitespace-nowrap px-5 py-4">{dateFormatter.format(new Date(run.completedAt))}</td>
            <td className="px-5 py-4 font-semibold text-zinc-900">{run.quantityProduced}</td>
            <td className="px-5 py-4">{run.projectName ?? "General Stock"}</td>
            <td className="px-5 py-4">v{run.bomVersionNumber}</td>
            <td className="px-5 py-4">{run.producedByFullName}</td>
          </tr>)}
        </tbody>
      </table>
    </div>;
  }

  return <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
    aria-label="Production History">
    <h2 className="text-xl font-bold text-zinc-900">Production History</h2>
    <div className="mt-5">{content}</div>
  </section>;
}
