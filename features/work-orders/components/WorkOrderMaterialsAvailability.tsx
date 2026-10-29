import { isWorkOrderAvailabilityEnabled } from "../../../app/config/workOrderAvailabilityActivation";
import { useWorkOrderAvailability } from "../hooks/useWorkOrderAvailability";
import WorkOrderMaterialsTable, { type WorkOrderMaterialsTableProps } from "./WorkOrderMaterialsTable";

interface Props extends WorkOrderMaterialsTableProps {
  workOrderId: string; version: string; revision: string; unsaved: boolean;
}
function ActivatedMaterials({ workOrderId, version, revision, unsaved, ...props }: Props) {
  const { allowed, checkingAccess, query, value } = useWorkOrderAvailability(workOrderId, version, revision, unsaved);
  // Never associate a saved Product total with a different locally edited material set.
  const totals = new Map<string, bigint>();
  let valid = true;
  for (const row of props.materials) {
    if (!/^[1-9][0-9]*$/.test(row.quantity)) { valid = false; break; }
    totals.set(row.productId, (totals.get(row.productId) ?? 0n) + BigInt(row.quantity));
  }
  const matches = !unsaved && valid && value && value.materials.length === totals.size && value.materials.every(row =>
    totals.get(row.productId) === BigInt(row.required));
  const availability = matches ? new Map(value.materials.map(row => [row.productId, row])) : undefined;
  return <>
    <p className="mt-4 text-sm text-zinc-600">Availability is advisory, not a reservation or a guarantee of future Finish success.
      Product totals combine frozen BOM and supplemental rows; they are not per-row allocations.</p>
    {unsaved ? <p role="status" className="mt-2 text-sm text-amber-800">Save material changes to refresh authoritative availability.</p> :
      checkingAccess || query.isFetching || (allowed && query.isPending) ? <p role="status" className="mt-2 text-sm text-zinc-600">Loading material availability…</p> :
      !availability ? <p role="alert" className="mt-2 text-sm text-zinc-700">Availability unavailable.
        {allowed && <button type="button" disabled={query.isFetching} className="ml-2 underline"
          onClick={() => void query.refetch({ cancelRefetch: false })}>Retry availability</button>}</p> :
      value && <p className="mt-2 text-xs text-zinc-500">Observed at <time dateTime={value.asOf}>{value.asOf}</time>.</p>}
    <WorkOrderMaterialsTable {...props} showAvailability availability={availability} />
  </>;
}
export default function WorkOrderMaterialsAvailability({ workOrderId, version, revision, unsaved, ...props }: Props) {
  // Closed path mounts no query/auth hook and leaves the existing Materials UI intact.
  if (!isWorkOrderAvailabilityEnabled()) return <WorkOrderMaterialsTable {...props} />;
  return <ActivatedMaterials {...props} workOrderId={workOrderId} version={version} revision={revision} unsaved={unsaved} />;
}
