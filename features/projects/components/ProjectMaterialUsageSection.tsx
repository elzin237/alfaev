import { useMemo, useState } from "react";

import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { useProjectMaterialUsage } from "../hooks/useProjectMaterialUsage";

export function ProjectMaterialUsageSection({ projectId }: { projectId: string }) {
  const { usageQuery } = useProjectMaterialUsage(projectId);
  const [search, setSearch] = useState("");
  const usage = usageQuery.data?.ok ? usageQuery.data.value : [];
  const filteredUsage = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return usage;
    return usage.filter((row) =>
      row.productName.toLowerCase().includes(query) ||
      row.serialNumber.includes(query)
    );
  }, [search, usage]);

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
  } else if (filteredUsage.length === 0) {
    content = (
      <p role="status" className="rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-6 text-sm text-zinc-600">
        No materials match your search.
      </p>
    );
  } else {
    content = (
      <div
        data-testid="material-usage-scroll"
        className="max-h-[36rem] max-w-full overflow-auto rounded-2xl border border-zinc-200"
      >
        <table className="min-w-[36rem] w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th scope="col" className="px-4 py-3">Serial Number / Šifra</th>
              <th scope="col" className="px-4 py-3">Product</th>
              <th scope="col" className="px-4 py-3">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {filteredUsage.map((row) => (
              <tr key={row.productId}>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-zinc-700">
                  {row.serialNumber}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {row.productName}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-700">
                  {row.quantity}
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
      <div>
        <h2 className="text-xl font-bold text-zinc-900">Material Usage</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Physical materials consumed by this Project.
        </p>
      </div>
      {!usageQuery.isPending && !usageQuery.isError && usageQuery.data?.ok && usage.length > 0 && (
        <div className="my-5 max-w-xl">
          <label htmlFor={`project-material-usage-search-${projectId}`} className="sr-only">
            Search materials
          </label>
          <input
            id={`project-material-usage-search-${projectId}`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search materials by Product name or Serial Number"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      )}
      {(usageQuery.isPending || usageQuery.isError || !usageQuery.data?.ok || usage.length === 0) && (
        <div className="mt-5">{content}</div>
      )}
      {!usageQuery.isPending && !usageQuery.isError && usageQuery.data?.ok && usage.length > 0 && content}
    </section>
  );
}
