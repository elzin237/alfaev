import { useState } from "react";

import { useAuth } from "../../../app/auth/AuthProvider";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { useInventoryBalance } from "../hooks/useInventoryBalance";
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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const balance = balanceQuery.data?.ok ? balanceQuery.data.value : null;
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
