import { Link } from "react-router";

import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { useProjectMaterialUsage } from "../hooks/useProjectMaterialUsage";

const consumedAtFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ProjectMaterialUsageSection({ projectId }: { projectId: string }) {
  const { usageQuery, canViewWorkOrders } = useProjectMaterialUsage(projectId);
  const usage = usageQuery.data?.ok ? usageQuery.data.value : [];

  let content;
  if (usageQuery.isPending) {
    content = <LoadingState message="Loading material usage..." />;
  } else if (usageQuery.isError || !usageQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to load Material Usage"
        message={
          usageQuery.data?.ok === false
            ? usageQuery.data.error.message
            : "Project material usage could not be loaded. Please try again."
        }
        onRetry={() => void usageQuery.refetch()}
      />
    );
  } else if (usage.length === 0) {
    content = (
      <EmptyState
        title="No Project material usage yet."
        description="Finished Work Order and Project-linked PCB Production consumption will appear here."
      />
    );
  } else {
    content = (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th scope="col" className="px-4 py-3">Serial Number / Šifra</th>
              <th scope="col" className="px-4 py-3">Product</th>
              <th scope="col" className="px-4 py-3">Quantity</th>
              <th scope="col" className="px-4 py-3">Source Type</th>
              <th scope="col" className="px-4 py-3">Source Record</th>
              <th scope="col" className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {usage.map((row) => (
              <tr key={row.movementId}>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-zinc-700">
                  {row.serialNumber}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {row.productName}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-700">
                  {row.quantity}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                  {row.sourceType === "work_order" ? "Work Order" : "PCB Production"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {row.sourceWorkOrderId && canViewWorkOrders
                    ? (
                      <Link
                        to={`/work-orders/${row.sourceWorkOrderId}`}
                        className="font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition hover:decoration-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2"
                      >
                        {row.sourceLabel}
                      </Link>
                    )
                    : <span className="font-medium text-zinc-700">{row.sourceLabel}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                  <time dateTime={row.consumedAt}>
                    {consumedAtFormatter.format(new Date(row.consumedAt))}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section
      aria-label="Material Usage"
      className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="mb-5">
        <h2 className="text-xl font-bold text-zinc-900">Material Usage</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Physical material consumed by Finished Work Orders and Project-linked PCB Production.
        </p>
      </div>
      {content}
    </section>
  );
}
