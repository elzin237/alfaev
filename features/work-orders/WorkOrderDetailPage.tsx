import type { ReactNode } from "react";
import { Link, useParams } from "react-router";

import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import WorkOrderDraftShell from "./components/WorkOrderDraftShell";
import { useWorkOrderDetail } from "./hooks/useWorkOrderDetail";
import { isWorkOrderId } from "./services/workOrderService";

function BackToWorkOrdersLink() {
  return (
    <Link
      to="/work-orders"
      className="inline-flex rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300"
    >
      Back to Work Orders
    </Link>
  );
}

function WorkOrderDetailPage() {
  const { workOrderId = "" } = useParams<{ workOrderId: string }>();
  const {
    canEditDraft,
    detailQuery,
    isResolvingBarcode,
    isSaving,
    projectChoicesQuery,
    reloadLatestDraft,
    resolveBarcode,
    saveDraft,
  } =
    useWorkOrderDetail(workOrderId);
  let content: ReactNode;

  if (!isWorkOrderId(workOrderId)) {
    content = (
      <ErrorState
        title="Work Order not found"
        message="The Work Order could not be found."
      />
    );
  } else if (detailQuery.isPending) {
    content = <LoadingState message="Loading Work Order..." />;
  } else if (detailQuery.isError || !detailQuery.data?.ok) {
    const isNotFound = detailQuery.data?.ok === false &&
      detailQuery.data.error.code === "work_order_not_found";
    content = (
      <ErrorState
        title={isNotFound ? "Work Order not found" : "Unable to load Work Order"}
        message={
          detailQuery.data?.ok === false
            ? detailQuery.data.error.message
            : "The Work Order details could not be loaded."
        }
        onRetry={isNotFound ? undefined : () => void detailQuery.refetch()}
      />
    );
  } else {
    const workOrder = detailQuery.data.value;
    const projectChoices = projectChoicesQuery.data?.ok
      ? projectChoicesQuery.data.value
      : [];
    const projectChoicesError = projectChoicesQuery.isError
      ? "Project choices could not be loaded."
      : projectChoicesQuery.data?.ok === false
      ? projectChoicesQuery.data.error.message
      : null;

    content = (
      <>
        <PageHeader
          title={workOrder.workOrderNumber}
          description={workOrder.status === "draft"
            ? "Draft Work Order"
            : "Finished Work Order"}
          actions={(
            <StatusBadge
              label={workOrder.status === "draft" ? "Draft" : "Finished"}
              tone={workOrder.status === "draft" ? "neutral" : "success"}
            />
          )}
        />

        {workOrder.status === "draft" ? (
          <WorkOrderDraftShell
            workOrder={workOrder}
            canEdit={canEditDraft}
            projectChoices={projectChoices}
            projectChoicesError={projectChoicesError}
            projectChoicesLoading={projectChoicesQuery.isPending && canEditDraft}
            isSaving={isSaving}
            isResolvingBarcode={isResolvingBarcode}
            onReloadLatest={reloadLatestDraft}
            onRetryProjectChoices={() => void projectChoicesQuery.refetch()}
            onResolveBarcode={resolveBarcode}
            onSave={(submission) => saveDraft({
              ...submission,
              expectedUpdatedAt: workOrder.updatedAt,
            })}
          />
        ) : (
          <section className="rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
            <p className="text-sm leading-6 text-zinc-600">
              The Finished Work Order detail experience is not implemented in this step.
            </p>
          </section>
        )}

        <BackToWorkOrdersLink />
      </>
    );
  }

  return <section className="space-y-6">{content}</section>;
}

export default WorkOrderDetailPage;
