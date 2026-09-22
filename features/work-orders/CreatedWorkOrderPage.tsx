import { Link, useLocation, useParams } from "react-router";

import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import {
  isWorkOrderId,
  isWorkOrderNumber,
} from "./services/workOrderService";

interface CreatedWorkOrderState {
  createdWorkOrder?: {
    workOrderId?: unknown;
    workOrderNumber?: unknown;
  };
}

function CreatedWorkOrderPage() {
  const { workOrderId } = useParams();
  const location = useLocation();
  const state = location.state as CreatedWorkOrderState | null;
  const created = state?.createdWorkOrder;
  const hasTrustedNavigationResult =
    isWorkOrderId(workOrderId) &&
    isWorkOrderId(created?.workOrderId) &&
    created.workOrderId === workOrderId &&
    isWorkOrderNumber(created?.workOrderNumber);

  return (
    <section className="space-y-6">
      <PageHeader
        title={hasTrustedNavigationResult
          ? created.workOrderNumber as string
          : "Work Order Draft"}
        description={hasTrustedNavigationResult
          ? "The Work Order Draft was created successfully."
          : "Work Order details are not available on this temporary creation destination."}
      />

      <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        {hasTrustedNavigationResult ? (
          <div className="space-y-4">
            <StatusBadge label="Draft" tone="neutral" />
            <p role="status" className="text-sm text-zinc-600">
              Draft created. Its Project, Customer, Description, and materials
              have not been set yet.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-6 text-zinc-600">
            Return to Work Orders to view the current list. A later task will add
            the authoritative Work Order detail read.
          </p>
        )}
        <Link
          to="/work-orders"
          className="mt-5 inline-flex rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300"
        >
          Back to Work Orders
        </Link>
      </div>
    </section>
  );
}

export default CreatedWorkOrderPage;
