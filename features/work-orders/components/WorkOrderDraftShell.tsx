import { useEffect, useMemo, useRef, useState } from "react";

import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import WorkOrderBarcodeScanInput from "./WorkOrderBarcodeScanInput";
import WorkOrderDeleteDraftDialog from "./WorkOrderDeleteDraftDialog";
import WorkOrderMaterialsTable from "./WorkOrderMaterialsTable";
import type { DraftWorkOrderMaterial } from "./WorkOrderMaterialRow";
import type {
  DraftWorkOrderDeleteResult,
  DraftWorkOrderSaveResult,
  PersistedDraftWorkOrderMaterial,
  WorkOrderDetail,
  WorkOrderMaterialLoadResult,
  WorkOrderProjectChoice,
} from "../services/workOrderService";
import { isValidWorkOrderMaterialQuantity } from "../workOrderMaterialQuantity";

export interface WorkOrderDraftSubmission {
  projectId: string | null;
  description: string;
  expectedUpdatedAt: string;
  materials: DraftWorkOrderMaterial[];
}

export interface ReloadedWorkOrderDraft {
  ok: true;
  detail: WorkOrderDetail;
  materials: PersistedDraftWorkOrderMaterial[];
}

interface WorkOrderDraftShellProps {
  workOrder: WorkOrderDetail;
  canEdit: boolean;
  canDelete: boolean;
  projectChoices: WorkOrderProjectChoice[];
  projectChoicesError: string | null;
  projectChoicesLoading: boolean;
  persistedMaterials: PersistedDraftWorkOrderMaterial[];
  materialsLoading: boolean;
  materialsError: string | null;
  materialsReady: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isLoadingMaterial: boolean;
  onReloadLatest: () => Promise<ReloadedWorkOrderDraft | { ok: false }>;
  onRetryMaterials: () => void;
  onRetryProjectChoices: () => void;
  onLoadMaterial: (serialNumber: string) => Promise<WorkOrderMaterialLoadResult>;
  onSave: (submission: WorkOrderDraftSubmission) => Promise<DraftWorkOrderSaveResult>;
  onDelete: (expectedUpdatedAt: string) => Promise<DraftWorkOrderDeleteResult>;
}

function ReadOnlyValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-2 whitespace-pre-wrap text-sm font-medium text-zinc-900">{value ?? "Not set"}</dd>
    </div>
  );
}

function WorkOrderDraftShell({
  workOrder,
  canEdit,
  canDelete,
  projectChoices,
  projectChoicesError,
  projectChoicesLoading,
  persistedMaterials,
  materialsLoading,
  materialsError,
  materialsReady,
  isSaving,
  isDeleting,
  isLoadingMaterial,
  onReloadLatest,
  onRetryMaterials,
  onRetryProjectChoices,
  onLoadMaterial,
  onSave,
  onDelete,
}: WorkOrderDraftShellProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(workOrder.projectId ?? "");
  const [savedProjectId, setSavedProjectId] = useState(workOrder.projectId ?? "");
  const [savedCustomerName, setSavedCustomerName] = useState(workOrder.customerName);
  const [description, setDescription] = useState(workOrder.description ?? "");
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(workOrder.updatedAt);
  const [materials, setMaterials] = useState<DraftWorkOrderMaterial[]>([]);
  const [hydratedWorkOrderId, setHydratedWorkOrderId] = useState<string | null>(null);
  const [showRequiredErrors, setShowRequiredErrors] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<
    | { kind: "error"; code: string; message: string }
    | { kind: "success"; message: string }
    | null
  >(null);
  const [isReloading, setIsReloading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteDialogError, setDeleteDialogError] = useState<string | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<
    { code: string; message: string } | null
  >(null);
  const [materialFocusRequest, setMaterialFocusRequest] = useState<{ productId: string; requestId: number } | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const barcodeResolutionInFlight = useRef(false);
  const nextMaterialFocusRequestId = useRef(0);
  const submissionInFlight = useRef(false);
  const deleteSubmissionInFlight = useRef(false);

  useEffect(() => {
    setSelectedProjectId(workOrder.projectId ?? "");
    setSavedProjectId(workOrder.projectId ?? "");
    setSavedCustomerName(workOrder.customerName);
    setDescription(workOrder.description ?? "");
    setExpectedUpdatedAt(workOrder.updatedAt);
    setMaterials([]);
    setHydratedWorkOrderId(null);
    setMaterialFocusRequest(null);
    setBarcodeError(null);
    setSaveFeedback(null);
    setShowRequiredErrors(false);
    setDeleteDialogOpen(false);
    setDeleteDialogError(null);
    setDeleteFeedback(null);
  }, [workOrder.id]);

  useEffect(() => {
    if (materialsReady && hydratedWorkOrderId !== workOrder.id) {
      setMaterials(persistedMaterials.map((material) => ({ ...material })));
      setHydratedWorkOrderId(workOrder.id);
    }
  }, [hydratedWorkOrderId, materialsReady, persistedMaterials, workOrder.id]);

  const selectedChoice = useMemo(
    () => projectChoices.find((choice) => choice.id === selectedProjectId),
    [projectChoices, selectedProjectId],
  );
  const hasLocalProjectChange = selectedProjectId !== savedProjectId;
  const customerName = hasLocalProjectChange
    ? selectedChoice?.customerName ?? null
    : savedCustomerName;
  const currentProjectIsMissingFromChoices = Boolean(
    savedProjectId && !projectChoices.some((choice) => choice.id === savedProjectId),
  );
  const materialsHydrated = materialsReady &&
    hydratedWorkOrderId === workOrder.id;
  const editingDisabled = isSaving || isDeleting || !materialsHydrated;

  async function handleSave() {
    if (
      submissionInFlight.current || deleteSubmissionInFlight.current ||
      isSaving || isDeleting || !canEdit ||
      !materialsHydrated
    ) return;
    if (materials.some((material) => !isValidWorkOrderMaterialQuantity(material.quantity))) {
      setShowRequiredErrors(true);
      setSaveFeedback({
        kind: "error",
        code: "invalid_quantity",
        message: "Enter a valid positive whole-number Quantity for every material.",
      });
      return;
    }

    submissionInFlight.current = true;
    setSaveFeedback(null);
    const submission: WorkOrderDraftSubmission = {
      projectId: selectedProjectId || null,
      description,
      expectedUpdatedAt,
      materials: materials.map((material) => ({ ...material })),
    };
    try {
      const result = await onSave(submission);
      if (result.ok) {
        setDescription(submission.description.trim());
        setSavedProjectId(submission.projectId ?? "");
        setSavedCustomerName(selectedChoice?.customerName ??
          (submission.projectId === workOrder.projectId ? workOrder.customerName : null));
        setExpectedUpdatedAt(result.value.updatedAt);
        setShowRequiredErrors(false);
        setSaveFeedback({ kind: "success", message: "Draft saved." });
      } else {
        setSaveFeedback({ kind: "error", code: result.error.code, message: result.error.message });
      }
    } catch {
      setSaveFeedback({ kind: "error", code: "draft_save_failed", message: "The Draft could not be saved. Please try again." });
    } finally {
      submissionInFlight.current = false;
    }
  }

  async function handleReloadLatest() {
    if (isReloading || isDeleting) return;
    setIsReloading(true);
    try {
      const result = await onReloadLatest();
      if (result.ok) {
        setSelectedProjectId(result.detail.projectId ?? "");
        setSavedProjectId(result.detail.projectId ?? "");
        setSavedCustomerName(result.detail.customerName);
        setDescription(result.detail.description ?? "");
        setExpectedUpdatedAt(result.detail.updatedAt);
        setMaterials(result.materials.map((material) => ({ ...material })));
        setHydratedWorkOrderId(result.detail.id);
        setSaveFeedback(null);
        setDeleteFeedback(null);
        setDeleteDialogOpen(false);
        setDeleteDialogError(null);
        setShowRequiredErrors(false);
      }
    } finally {
      setIsReloading(false);
    }
  }

  async function handleBarcodeScan(serialNumber: string) {
    if (barcodeResolutionInFlight.current || isLoadingMaterial || editingDisabled) return;
    barcodeResolutionInFlight.current = true;
    setBarcodeError(null);
    try {
      const result = await onLoadMaterial(serialNumber);
      if (result.ok) {
        setMaterials((current) => current.some((item) => item.productId === result.value.productId)
          ? current
          : [...current, { ...result.value, quantity: "" }]);
        nextMaterialFocusRequestId.current += 1;
        setMaterialFocusRequest({ productId: result.value.productId, requestId: nextMaterialFocusRequestId.current });
      } else setBarcodeError(result.error.message);
    } catch {
      setBarcodeError("The Product could not be resolved. Please try again.");
    } finally {
      barcodeResolutionInFlight.current = false;
    }
  }

  async function handleDeleteConfirm() {
    if (
      deleteSubmissionInFlight.current || submissionInFlight.current ||
      isDeleting || isSaving
    ) return;
    deleteSubmissionInFlight.current = true;
    setDeleteDialogError(null);
    setDeleteFeedback(null);
    try {
      const result = await onDelete(expectedUpdatedAt);
      if (result.ok) {
        setDeleteDialogOpen(false);
        return;
      }

      if (
        result.error.code === "draft_delete_failed" ||
        result.error.code === "invalid_delete_request"
      ) {
        setDeleteDialogError(result.error.message);
      } else {
        setDeleteDialogOpen(false);
        setDeleteFeedback(result.error);
      }
    } catch {
      setDeleteDialogError("The Draft could not be deleted. Please try again.");
    } finally {
      deleteSubmissionInFlight.current = false;
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-zinc-900">Draft details</h2>
        {canEdit ? (
          <form id="work-order-draft-form" className="mt-6 grid gap-6 lg:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
            <div>
              <label htmlFor="work-order-project" className="block text-sm font-semibold text-zinc-800">Project</label>
              <select id="work-order-project" value={selectedProjectId} disabled={editingDisabled || projectChoicesLoading || Boolean(projectChoicesError)} onChange={(event) => { setSelectedProjectId(event.target.value); setSaveFeedback(null); }} className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100">
                <option value="">Not selected</option>
                {currentProjectIsMissingFromChoices && savedProjectId && <option value={savedProjectId} disabled>{workOrder.projectName} (current)</option>}
                {projectChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
              </select>
              {projectChoicesLoading && <p role="status" className="mt-2 text-sm text-zinc-500">Loading Project choices...</p>}
              {projectChoicesError && <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-medium text-red-700">{projectChoicesError}</p><button type="button" onClick={onRetryProjectChoices} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">Try again</button></div>}
            </div>
            <div><label htmlFor="work-order-customer" className="block text-sm font-semibold text-zinc-800">Customer</label><input id="work-order-customer" readOnly value={customerName ?? "Not set"} className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-700" /></div>
            <div className="lg:col-span-2"><label htmlFor="work-order-description" className="block text-sm font-semibold text-zinc-800">Short Description</label><textarea id="work-order-description" value={description} disabled={isSaving || isDeleting} onChange={(event) => { setDescription(event.target.value); setSaveFeedback(null); }} rows={4} className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100" /></div>
          </form>
        ) : (
          <dl className="mt-6 grid gap-6 sm:grid-cols-2"><ReadOnlyValue label="Project" value={workOrder.projectName ?? "Not selected"} /><ReadOnlyValue label="Customer" value={workOrder.customerName} /><div className="sm:col-span-2"><ReadOnlyValue label="Short Description" value={workOrder.description} /></div></dl>
        )}
      </section>

      <section aria-labelledby="work-order-materials-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="work-order-materials-heading" className="text-xl font-bold text-zinc-900">Materials</h2>
        {materialsLoading ? <div className="mt-6"><LoadingState message="Loading Draft materials..." /></div> : materialsError ? <div className="mt-6"><ErrorState title="Unable to load Materials" message={materialsError} onRetry={onRetryMaterials} /></div> : materialsHydrated ? (
          <>
            {canEdit && <div className="mt-6"><WorkOrderBarcodeScanInput disabled={isLoadingMaterial || isSaving || isDeleting} onScan={(serial) => void handleBarcodeScan(serial)} refocusOnEnable={false} /></div>}
            {isLoadingMaterial && <p role="status" className="mt-4 text-sm text-zinc-600">Loading material...</p>}
            {barcodeError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{barcodeError}</p>}
            <WorkOrderMaterialsTable focusRequest={materialFocusRequest} materials={materials} onQuantityChange={(productId, quantity) => { setMaterials((current) => current.map((item) => item.productId === productId ? { ...item, quantity } : item)); setSaveFeedback(null); }} onRemove={(productId) => { setMaterials((current) => current.filter((item) => item.productId !== productId)); setSaveFeedback(null); }} readOnly={!canEdit} disabled={isSaving || isDeleting} showRequiredErrors={showRequiredErrors} />
          </>
        ) : materialsReady ? <div className="mt-6"><LoadingState message="Preparing Draft materials..." /></div> : null}
      </section>

      {(canEdit || canDelete || saveFeedback || deleteFeedback) && <section aria-label="Draft actions" className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        {saveFeedback?.kind === "success" && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{saveFeedback.message}</p>}
        {saveFeedback?.kind === "error" && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-medium text-red-700">{saveFeedback.message}</p>{saveFeedback.code === "stale_work_order" && <button type="button" disabled={isReloading} onClick={() => void handleReloadLatest()} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">{isReloading ? "Reloading..." : "Reload latest Draft"}</button>}</div>}
        {deleteFeedback && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-medium text-red-700">{deleteFeedback.message}</p>{deleteFeedback.code === "stale_work_order" && <button type="button" disabled={isReloading || isDeleting} onClick={() => void handleReloadLatest()} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">{isReloading ? "Reloading..." : "Reload latest Draft"}</button>}</div>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {canDelete ? <button type="button" disabled={isSaving || isDeleting} onClick={() => { setDeleteFeedback(null); setDeleteDialogError(null); setDeleteDialogOpen(true); }} className="rounded-xl border border-red-300 bg-white px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">Delete Draft</button> : <span />}
          {canEdit && <button type="submit" form="work-order-draft-form" disabled={isSaving || isDeleting || !materialsHydrated} className="rounded-xl border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? "Saving..." : "Save for Later"}</button>}
        </div>
      </section>}

      <WorkOrderDeleteDraftDialog
        open={deleteDialogOpen && canDelete}
        workOrderNumber={workOrder.workOrderNumber}
        isDeleting={isDeleting}
        errorMessage={deleteDialogError}
        onCancel={() => {
          if (isDeleting) return;
          setDeleteDialogOpen(false);
          setDeleteDialogError(null);
        }}
        onConfirm={() => void handleDeleteConfirm()}
      />
    </div>
  );
}

export default WorkOrderDraftShell;
