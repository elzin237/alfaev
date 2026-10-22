import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import { usePcbBomHistory } from "../hooks/usePcbBomHistory";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default function PcbBomHistory({ cardId }: { cardId: string }) {
  const historyQuery = usePcbBomHistory(cardId);

  let content;
  if (historyQuery.isPending) {
    content = <LoadingState message="Loading PCB BOM history..." />;
  } else if (historyQuery.isError || !historyQuery.data?.ok) {
    content = <ErrorState title="Unable to load BOM history"
      message={historyQuery.data?.ok === false
        ? historyQuery.data.error.message : "PCB BOM history could not be loaded."}
      onRetry={() => void historyQuery.refetch()} />;
  } else if (historyQuery.data.value.length === 0) {
    content = <EmptyState title="No BOM history"
      description="No BOM version has been saved for this finished-product definition yet." />;
  } else {
    content = <div className="overflow-x-auto rounded-2xl border border-zinc-200">
      <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
        <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <tr>
            <th scope="col" className="px-5 py-4">Version</th>
            <th scope="col" className="px-5 py-4">Created Date</th>
            <th scope="col" className="px-5 py-4">Created By</th>
            <th scope="col" className="px-5 py-4">Production Used?</th>
            <th scope="col" className="px-5 py-4">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {historyQuery.data.value.map((version) => <tr key={version.versionId} className="text-zinc-700">
            <td className="whitespace-nowrap px-5 py-4 font-semibold text-zinc-900">v{version.versionNumber}</td>
            <td className="whitespace-nowrap px-5 py-4">{dateFormatter.format(new Date(version.createdAt))}</td>
            <td className="px-5 py-4">{version.createdByFullName}</td>
            <td className="px-5 py-4">{version.productionUsed ? "Yes" : "No"}</td>
            <td className="px-5 py-4"><StatusBadge
              label={version.isActive ? "Active" : "Historical"}
              tone={version.isActive ? "success" : "neutral"} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>;
  }

  return <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
    aria-label="BOM History">
    <h2 className="text-xl font-bold text-zinc-900">BOM History</h2>
    <div className="mt-5">{content}</div>
  </section>;
}
