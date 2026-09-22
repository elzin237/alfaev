import { useState } from "react";
import { useNavigate } from "react-router";

import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import CreateDraftWorkOrderAction from "./components/CreateDraftWorkOrderAction";
import { useWorkOrderViewAccess } from "./hooks/useWorkOrderViewAccess";
import type { CreatedDraftWorkOrder } from "./services/workOrderService";

function NewWorkOrderPage() {
  const navigate = useNavigate();
  const { canView, isChecking } = useWorkOrderViewAccess();
  const [created, setCreated] = useState<CreatedDraftWorkOrder | null>(null);

  function handleCreated(result: CreatedDraftWorkOrder) {
    if (canView) {
      navigate(`/work-orders/${result.workOrderId}`, {
        state: { createdWorkOrder: result },
      });
      return;
    }

    setCreated(result);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Create Work Order"
        description="Create an empty Draft with an authoritative Work Order number."
      />
      {isChecking ? (
        <LoadingState message="Checking Work Order access..." />
      ) : (
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          {created ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold text-zinc-900">
                  {created.workOrderNumber}
                </h2>
                <StatusBadge label="Draft" tone="neutral" />
              </div>
              <p role="status" className="text-sm leading-6 text-zinc-600">
                Work Order Draft created successfully.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm leading-6 text-zinc-600">
                The Draft is created only when you select Create Work Order.
                Project, Customer, Description, and materials are added in later
                Draft steps.
              </p>
              <div className="mt-5">
                <CreateDraftWorkOrderAction onCreated={handleCreated} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default NewWorkOrderPage;
