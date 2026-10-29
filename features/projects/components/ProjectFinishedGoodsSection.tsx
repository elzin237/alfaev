import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { useProjectFinishedGoods } from "../hooks/useProjectFinishedGoods";
import type { ProjectStatus } from "../projectStatus";
import { maximumReservationChange, useProjectFinishedGoodsMutations } from "../hooks/useProjectFinishedGoodsMutations";
import { ProjectFinishedGoodsMutationDialog } from "./ProjectFinishedGoodsMutationDialog";

const columns = ["Product / Serial Number", "Outstanding demand", "Reserved Finished Goods", "Unreserved Project demand"];

export function ProjectFinishedGoodsSection({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const { contextQuery, canView, checkingPermissions, permissionError, retryPermissions } = useProjectFinishedGoods(projectId);
  const mutations = useProjectFinishedGoodsMutations(projectId, status, canView);
  const closed = status === "completed" || status === "cancelled";
  let content;
  // Never render cached protected rows when current access is absent or uncertain.
  if (checkingPermissions) content = <LoadingState message="Checking Finished Goods access..." />;
  else if (permissionError) content = <ErrorState title="Unable to verify Finished Goods access"
    message="Your permissions could not be verified. Please try again." onRetry={() => void retryPermissions()} />;
  else if (!canView) content = <p role="status" className="text-sm text-zinc-600">Project view and Finished Goods view permissions are required.</p>;
  else if (contextQuery.isPending) content = <LoadingState message="Loading Project Finished Goods..." />;
  else if (contextQuery.isError || !contextQuery.data?.ok) {
    const error = contextQuery.data?.ok === false ? contextQuery.data.error : undefined;
    content = <ErrorState title={error?.code === "project_not_found" ? "Project not found" : "Unable to load Finished Goods"}
      message={error?.message ?? "Project Finished Goods could not be loaded. Please try again."}
      onRetry={error?.code === "access_denied" || error?.code === "project_not_found" ? undefined : () => void contextQuery.refetch()} />;
  } else if (contextQuery.data.value.length === 0) content = <EmptyState title="No explicit Finished Goods requirements"
    description="Only explicitly required Product Calculator outputs appear here. A Project Product group name does not create demand or a reservation." />;
  else content = <div className="max-h-[28rem] max-w-full overflow-auto rounded-2xl border border-zinc-200"
    role="region" aria-label="Finished Goods requirements table" tabIndex={0}>
    <table className="w-full min-w-[48rem] divide-y divide-zinc-200 text-left text-sm">
      <caption className="sr-only">Finished Goods demand and reservations across all requirement groups in this Project</caption>
      <thead className="sticky top-0 z-10 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <tr>{columns.map(column => <th key={column} scope="col" className="px-4 py-3">{column}</th>)}
          {mutations.authorized && !closed && <th scope="col" className="px-4 py-3">Reservation actions</th>}</tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 bg-white">{contextQuery.data.value.map(row => <tr key={row.productId}>
        <th scope="row" className="px-4 py-3 font-medium text-zinc-900">{row.productName}
          <span className="mt-1 block font-mono text-xs font-normal text-zinc-500">{row.serialNumber}</span></th>
        {[row.outstandingDemand, row.projectReservedQuantity,
          row.outstandingDemand > row.projectReservedQuantity ? row.outstandingDemand-row.projectReservedQuantity : 0n].map((quantity, index) =>
          <td key={columns[index + 1]} className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-700"
            title={index === 1 ? row.reservationId === null ? "No reservation"
              : row.projectReservedQuantity === 0n ? "No quantity currently reserved" : "Reserved for this Project" : undefined}>
            {quantity.toString()}</td>)}
        {mutations.authorized && !closed && <td className="px-4 py-3"><div className="flex gap-2">
          {(["reserve", "release", "fulfill"] as const).map(operation => <button key={operation} type="button"
            aria-label={`${operation.charAt(0).toUpperCase()}${operation.slice(1)} ${row.productName}`}
            disabled={!mutations.canStart || maximumReservationChange(row, operation) <= 0n}
            onClick={() => void mutations.open(row, operation)}
            className="rounded-lg border border-zinc-300 px-3 py-2 capitalize focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">{operation}</button>)}
        </div></td>}
      </tr>)}</tbody>
    </table>
  </div>;

  return <section aria-label="Project Finished Goods" className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-bold text-zinc-900">Finished Goods requirements</h2>
        <p className="mt-1 text-sm text-zinc-500">One row per Product, with totals across all requirement groups in this Project.
          Unreserved Project demand is outstanding demand minus this Project's reservation, never below zero.
          Available stock is not a reservation for this Project. Mutation availability depends on backend activation and your permissions.</p>
        <p className="mt-1 text-xs text-zinc-500">These figures are separate from global Inventory availability and Raw + Customs planning shortages.
          Genuine requirement additions/increases reserve available FG automatically; later stock arrivals do not.</p>
        <p className="mt-1 text-xs text-zinc-500">Finished Goods fulfillment is not included in the Material Usage table. Reservation events and Inventory movement history remain authoritative.</p>
        {closed && <p className="mt-2 text-sm text-zinc-600">Closed Project history: demand is informational and does not contribute to open-Project commitments.</p>}
      </div>
      {canView && contextQuery.data?.ok && !contextQuery.isError && <button type="button"
        onClick={() => void contextQuery.refetch()} disabled={contextQuery.isFetching}
        className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50">Refresh Finished Goods</button>}
    </div>
    {content}
    {mutations.recoveryIssue && !mutations.selection && <div role="alert" className="mt-4 text-sm text-red-700">
      <p>{mutations.recoveryIssue}</p><button type="button" onClick={mutations.checkRecovery}
        className="mt-2 rounded-lg border px-3 py-2 focus-visible:ring-2 focus-visible:ring-red-500">Check recovery storage</button>
    </div>}
    {mutations.recoveryPendingWithoutAccess && <p role="status" className="mt-3 text-sm">A saved request requires reconciliation. Your current permissions do not allow replay. It has not been discarded; restore the required access or ask an Admin for assistance.</p>}
    {mutations.blockedByOtherScope && <p role="status">A request belongs to the previous profile or Project. Return to that context to reconcile it.</p>}
    <ProjectFinishedGoodsMutationDialog controller={mutations} />
  </section>;
}
