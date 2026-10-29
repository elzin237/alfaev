import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import FinishedWorkOrderView from "./components/FinishedWorkOrderView";
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
  const navigate = useNavigate();
  const {
    canDeleteDraft,
    canEditDraft,
    canFinishDraft,
    deleteDraft,
    detailQuery,
    finishDraft,
    finishedDetailQuery,
    finishedMaterialsQuery,
    finishedMovementsQuery,
    isLoadingMaterial,
    isDeleting,
    isFinishing,
    isSaving,
    materialsQuery,
    productionContextQuery,
    projectChoicesQuery,
    reloadLatestDraft,
    loadMaterial,
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
  } else if (productionContextQuery.isPending) {
    content = <LoadingState message="Loading Work Order production context..." />;
  } else if (productionContextQuery.isError || !productionContextQuery.data?.ok) {
    content = <ErrorState title="Unable to load Work Order"
      message={productionContextQuery.data?.ok === false
        ? productionContextQuery.data.error.message
        : "The Work Order production context could not be loaded."}
      onRetry={() => void productionContextQuery.refetch()} />;
  } else {
    const workOrder = detailQuery.data.value;
    const productionContext = productionContextQuery.data.value;
    const projectChoices = projectChoicesQuery.data?.ok
      ? projectChoicesQuery.data.value
      : [];
    const projectChoicesError = projectChoicesQuery.isError
      ? "Project choices could not be loaded."
      : projectChoicesQuery.data?.ok === false
      ? projectChoicesQuery.data.error.message
      : null;
    const persistedMaterials = materialsQuery.data?.ok
      ? materialsQuery.data.value
      : [];
    const materialsError = materialsQuery.isError
      ? "Draft materials could not be loaded. Please try again."
      : materialsQuery.data?.ok === false
      ? materialsQuery.data.error.message
      : null;
    const finishedReadError = finishedDetailQuery.data?.ok === false
      ? finishedDetailQuery.data.error.message
      : finishedMaterialsQuery.data?.ok === false
      ? finishedMaterialsQuery.data.error.message
      : finishedMovementsQuery.data?.ok === false
      ? finishedMovementsQuery.data.error.message
      : null;
    const finishedReadPending = finishedDetailQuery.isPending ||
      finishedMaterialsQuery.isPending || finishedMovementsQuery.isPending;
    const finishedReadFailed = finishedDetailQuery.isError ||
      finishedMaterialsQuery.isError || finishedMovementsQuery.isError ||
      Boolean(finishedReadError);

    content = (
      <>
        <PageHeader
          title={workOrder.workOrderNumber}
          description={workOrder.status === "draft"
            ? "Draft Work Order"
            : "Finished Work Order"}
          actions={productionContext && workOrder.status === "draft" ? undefined : (
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
            canDelete={canDeleteDraft}
            canFinish={canFinishDraft}
            productionContext={productionContext}
            projectChoices={projectChoices}
            projectChoicesError={projectChoicesError}
            projectChoicesLoading={projectChoicesQuery.isPending && canEditDraft}
            persistedMaterials={persistedMaterials}
            materialsLoading={materialsQuery.isPending}
            materialsError={materialsError}
            materialsReady={materialsQuery.data?.ok === true}
            isSaving={isSaving}
            isDeleting={isDeleting}
            isFinishing={isFinishing}
            isLoadingMaterial={isLoadingMaterial}
            onReloadLatest={reloadLatestDraft}
            onRetryMaterials={() => void materialsQuery.refetch()}
            onRetryProjectChoices={() => void projectChoicesQuery.refetch()}
            onLoadMaterial={loadMaterial}
            onSave={(submission) => saveDraft({
              projectId: submission.projectId,
              description: submission.description,
              expectedUpdatedAt: submission.expectedUpdatedAt,
              items: submission.materials.map((material) => ({
                productId: material.productId,
                quantity: material.quantity,
              })),
              materialSnapshot: submission.materials,
            })}
            onDelete={async (expectedUpdatedAt) => {
              const result = await deleteDraft(expectedUpdatedAt);
              if (result.ok || result.error.code === "work_order_not_found") {
                navigate("/work-orders", { replace: true });
              }
              return result;
            }}
            onFinishConfirm={(expectedUpdatedAt, actualGoodQuantity) => finishDraft({
              expectedUpdatedAt,
              ...(actualGoodQuantity === undefined ? {} : { actualGoodQuantity }),
            })}
          />
        ) : finishedReadPending ? (
          <LoadingState message="Loading Finished Work Order..." />
        ) : finishedReadFailed ? (
          <ErrorState
            title="Unable to load Finished Work Order"
            message={finishedReadError ??
              "The Finished Work Order could not be loaded."}
            onRetry={() => void Promise.all([
              finishedDetailQuery.refetch(),
              finishedMaterialsQuery.refetch(),
              finishedMovementsQuery.refetch(),
            ])}
          />
        ) : finishedDetailQuery.data?.ok &&
          finishedMaterialsQuery.data?.ok &&
          finishedMovementsQuery.data?.ok ? (
          <FinishedWorkOrderView
            detail={finishedDetailQuery.data.value}
            materials={finishedMaterialsQuery.data.value}
            movements={finishedMovementsQuery.data.value}
            productionContext={productionContext}
          />
        ) : (
          <ErrorState
            title="Unable to load Finished Work Order"
            message="The Finished Work Order could not be loaded."
            onRetry={() => void Promise.all([
              finishedDetailQuery.refetch(),
              finishedMaterialsQuery.refetch(),
              finishedMovementsQuery.refetch(),
            ])}
          />
        )}

        <BackToWorkOrdersLink />
      </>
    );
  }

  return <section className="space-y-6">{content}</section>;
}

export default WorkOrderDetailPage;
