import { useState } from "react";
import { useNavigate } from "react-router";

import { useWorkOrderCreation } from "../hooks/useWorkOrderCreation";
import type { CreatedDraftWorkOrder } from "../services/workOrderService";

export interface CreateDraftWorkOrderActionProps {
  onCreated?: (created: CreatedDraftWorkOrder) => void;
}

function CreateDraftWorkOrderAction({ onCreated }: CreateDraftWorkOrderActionProps) {
  const navigate = useNavigate();
  const { canCreate, create, isPending } = useWorkOrderCreation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const creating = isPending || isSubmitting;

  if (!canCreate) return null;

  async function handleCreate() {
    if (creating) return;

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const result = await create();
      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      if (onCreated) {
        onCreated(result.value);
      } else {
        navigate(`/work-orders/${result.value.workOrderId}`, {
          state: { createdWorkOrder: result.value },
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        disabled={creating}
        onClick={() => void handleCreate()}
        className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {creating ? "Creating..." : "Create Work Order"}
      </button>
      {errorMessage && (
        <p role="alert" className="max-w-sm text-sm font-medium text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

export default CreateDraftWorkOrderAction;
