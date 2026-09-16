import { useState } from "react";

import { useAuth } from "../../../app/auth/AuthProvider";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { useInventoryBalance } from "../hooks/useInventoryBalance";
import { useInventoryCommitments, useProductProjectCommitments } from "../hooks/useInventoryCommitments";
import InventoryAdjustmentDialog from "./InventoryAdjustmentDialog";

export interface InventoryBalanceSectionProps {
  productId: string;
  productIsActive: boolean;
}

function InventoryBalanceSection({
  productId,
  productIsActive,
}: InventoryBalanceSectionProps) {
  const { isAdmin } = useAuth();
  const { balanceQuery, adjust } = useInventoryBalance(productId);
  const commitmentsQuery = useInventoryCommitments();
  const [showProjects, setShowProjects] = useState(false);
  const projectQuery = useProductProjectCommitments(productId, showProjects);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const balance = balanceQuery.data?.ok ? balanceQuery.data.value : null;
  const commitment = commitmentsQuery.data?.ok
    ? commitmentsQuery.data.value.find((item) => item.productId === productId)
    : undefined;
  const canAdjust = isAdmin && productIsActive;

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Inventory balance</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Current whole-number stock for this Product.
          </p>
        </div>
        {canAdjust && (
          <button
            type="button"
            disabled={!balance}
            onClick={() => {
              setSuccessMessage(null);
              setIsDialogOpen(true);
            }}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Adjust Inventory
          </button>
        )}
      </div>

      <div className="mt-6">
        {balanceQuery.isPending ? (
          <LoadingState message="Loading Inventory balance..." />
        ) : balanceQuery.isError || !balanceQuery.data?.ok ? (
          <ErrorState
            title="Unable to load Inventory balance"
            message={balanceQuery.data?.ok === false
              ? balanceQuery.data.error.message
              : "The Inventory balance could not be loaded."}
            onRetry={() => void balanceQuery.refetch()}
          />
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Current Quantity
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-900">
              {balanceQuery.data.value.quantity}
            </p>
          </div>
        )}
      </div>

      <div className="mt-5">
        {commitmentsQuery.isPending ? (
          <LoadingState message="Loading Project commitments..." />
        ) : commitmentsQuery.isError || !commitmentsQuery.data?.ok || !commitment ? (
          <ErrorState
            title="Unable to load Project commitments"
            message="Project commitment figures are unavailable."
            onRetry={() => void commitmentsQuery.refetch()}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                ["Physical Quantity", commitment.physicalQuantity],
                ["Committed to Projects", commitment.committedToProjects],
                ["Available after Commitments", commitment.availableAfterCommitments],
              ] as const).map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900">{value.toString()}</p>
                </div>
              ))}
            </div>
            {commitment.availableAfterCommitments < 0n && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                Shortage: Project commitments exceed physical stock by {(-commitment.availableAfterCommitments).toString()}.
              </p>
            )}
            {commitment.committedToProjects > 0n && (
              <button type="button" className="text-sm font-semibold text-zinc-900 underline" onClick={() => setShowProjects((current) => !current)}>
                {showProjects ? "Hide Project commitments" : "View Project commitments"}
              </button>
            )}
            {showProjects && commitment.committedToProjects > 0n && (
              projectQuery.isPending ? <LoadingState message="Loading Project attribution..." />
                : projectQuery.isError || !projectQuery.data?.ok ? (
                  <ErrorState title="Unable to load Project attribution" message="Project attribution is unavailable." onRetry={() => void projectQuery.refetch()} />
                ) : projectQuery.data.value.length === 0 ? (
                  <p className="text-sm text-zinc-500">No open Project commitments found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead><tr>{["Project", "Planned", "Consumed", "Outstanding"].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-semibold">{heading}</th>)}</tr></thead>
                      <tbody>{projectQuery.data.value.map((item) => (
                        <tr key={item.projectId} className="border-t border-zinc-200">
                          <th scope="row" className="px-3 py-2 font-medium">{item.projectName}</th>
                          <td className="px-3 py-2 tabular-nums">{item.plannedRequirement.toString()}</td>
                          <td className="px-3 py-2 tabular-nums">{item.actualProjectConsumption.toString()}</td>
                          <td className="px-3 py-2 tabular-nums">{item.outstandingCommitment.toString()}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )
            )}
          </div>
        )}
      </div>

      {successMessage && (
        <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}

      {balance && (
        <InventoryAdjustmentDialog
          open={isDialogOpen}
          currentQuantity={balance.quantity}
          onClose={() => setIsDialogOpen(false)}
          onSubmit={adjust}
          onSucceeded={(adjustment) => {
            setSuccessMessage(
              `Inventory adjusted. Resulting quantity: ${adjustment.quantityAfter}.`,
            );
          }}
        />
      )}
    </section>
  );
}

export default InventoryBalanceSection;
