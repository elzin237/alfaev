import type { ReactNode } from "react";

import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { useInventoryMovements } from "../hooks/useInventoryMovements";
import type { InventoryMovement } from "../services/inventoryMovementService";

export interface InventoryHistorySectionProps {
  productId: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatLabel(value: string): string {
  const normalized = value.replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

function formatContext(movement: InventoryMovement): string {
  const context: string[] = [];

  if (movement.reason) context.push(movement.reason);
  if (movement.sourceId) context.push(`Source record: ${movement.sourceId}`);
  if (movement.projectId) context.push(`Project: ${movement.projectId}`);
  if (movement.reversalOfMovementId) {
    context.push(`Reversal of: ${movement.reversalOfMovementId}`);
  }

  return context.length > 0 ? context.join(" · ") : "—";
}

function InventoryHistorySection({ productId }: InventoryHistorySectionProps) {
  const movementsQuery = useInventoryMovements(productId);
  let content: ReactNode;

  if (movementsQuery.isPending) {
    content = <LoadingState message="Loading Inventory history..." />;
  } else if (movementsQuery.isError || !movementsQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to load Inventory history"
        message={movementsQuery.data?.ok === false
          ? movementsQuery.data.error.message
          : "The Inventory history could not be loaded."}
        onRetry={() => void movementsQuery.refetch()}
      />
    );
  } else if (movementsQuery.data.value.length === 0) {
    content = (
      <EmptyState
        title="No Inventory movements"
        description="No stock movements have been recorded for this Product."
      />
    );
  } else {
    content = (
      <div className="overflow-hidden rounded-2xl border border-zinc-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200">
            <thead className="bg-zinc-50">
              <tr>
                {[
                  "Date",
                  "Type / Source",
                  "Delta",
                  "Before",
                  "After",
                  "User",
                  "Reason / Context",
                ].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {movementsQuery.data.value.map((movement) => (
                <tr key={movement.movementId} className="text-sm text-zinc-700">
                  <td className="whitespace-nowrap px-5 py-4">
                    {dateFormatter.format(new Date(movement.createdAt))}
                  </td>
                  <td className="px-5 py-4">
                    <span className="font-semibold text-zinc-900">
                      {formatLabel(movement.movementType)}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      {movement.sourceType
                        ? formatLabel(movement.sourceType)
                        : "No source"}
                    </span>
                  </td>
                  <td className={`whitespace-nowrap px-5 py-4 font-semibold tabular-nums ${
                    movement.quantityDelta > 0
                      ? "text-emerald-700"
                      : movement.quantityDelta < 0
                        ? "text-red-700"
                        : "text-zinc-700"
                  }`}>
                    {formatDelta(movement.quantityDelta)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                    {movement.quantityBefore}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                    {movement.quantityAfter}
                  </td>
                  <td className="px-5 py-4 font-medium text-zinc-900">
                    {movement.actorFullName}
                  </td>
                  <td className="min-w-64 px-5 py-4">
                    {formatContext(movement)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="inventory-history-heading"
      className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div>
        <h2 id="inventory-history-heading" className="text-xl font-bold text-zinc-900">
          Inventory History
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Read-only stock movement history for this Product.
        </p>
      </div>
      <div className="mt-6">{content}</div>
    </section>
  );
}

export default InventoryHistorySection;
