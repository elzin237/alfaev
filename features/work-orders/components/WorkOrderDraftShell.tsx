import { useEffect, useMemo, useRef, useState } from "react";

import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import WorkOrderBarcodeScanInput from "./WorkOrderBarcodeScanInput";
import WorkOrderDeleteDraftDialog from "./WorkOrderDeleteDraftDialog";
import WorkOrderFinishDialog from "./WorkOrderFinishDialog";
import WorkOrderMaterialsAvailability from "./WorkOrderMaterialsAvailability";
import PcbWorkOrderOverview from "./PcbWorkOrderOverview";
import type { DraftWorkOrderMaterial } from "./WorkOrderMaterialRow";
import type {
  DraftWorkOrderDeleteResult,
  DraftWorkOrderSaveResult,
  PersistedDraftWorkOrderMaterial,
  WorkOrderDetail,
  WorkOrderMaterialLoadResult,
  WorkOrderProjectChoice,
} from "../services/workOrderService";
import type { FinishWorkOrderResult } from "../services/workOrderFinishService";
import {
  normalizeActualGoodQuantity,
  type PcbProductionWorkOrderContext,
} from "../services/pcbProductionWorkOrderService";
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
  canFinish: boolean;
  productionContext?: PcbProductionWorkOrderContext | null;
  projectChoices: WorkOrderProjectChoice[];
  projectChoicesError: string | null;
  projectChoicesLoading: boolean;
  persistedMaterials: PersistedDraftWorkOrderMaterial[];
  materialsLoading: boolean;
  materialsError: string | null;
  materialsReady: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isFinishing: boolean;
  isLoadingMaterial: boolean;
  onReloadLatest: () => Promise<ReloadedWorkOrderDraft | { ok: false }>;
  onRetryMaterials: () => void;
  onRetryProjectChoices: () => void;
  onLoadMaterial: (serialNumber: string) => Promise<WorkOrderMaterialLoadResult>;
  onSave: (submission: WorkOrderDraftSubmission) => Promise<DraftWorkOrderSaveResult>;
  onDelete: (expectedUpdatedAt: string) => Promise<DraftWorkOrderDeleteResult>;
  onFinishConfirm: (expectedUpdatedAt: string, actualGoodQuantity?: string) => Promise<FinishWorkOrderResult>;
}

function materialSignature(materials: DraftWorkOrderMaterial[]): string {
  return materials
    .map((material) =>
      `${material.sourceType}:${material.productId}:${material.quantity}`
    )
    .sort()
    .join("|");
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
  canFinish,
  productionContext = null,
  projectChoices,
  projectChoicesError,
  projectChoicesLoading,
  persistedMaterials,
  materialsLoading,
  materialsError,
  materialsReady,
  isSaving,
  isDeleting,
  isFinishing,
  isLoadingMaterial,
  onReloadLatest,
  onRetryMaterials,
  onRetryProjectChoices,
  onLoadMaterial,
  onSave,
  onDelete,
  onFinishConfirm,
}: WorkOrderDraftShellProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(workOrder.projectId ?? "");
  const [savedProjectId, setSavedProjectId] = useState(workOrder.projectId ?? "");
  const [savedCustomerName, setSavedCustomerName] = useState(workOrder.customerName);
  const [savedProjectName, setSavedProjectName] = useState(workOrder.projectName);
  const [description, setDescription] = useState(workOrder.description ?? "");
  const [savedDescription, setSavedDescription] = useState(workOrder.description ?? "");
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(workOrder.updatedAt);
  const [materials, setMaterials] = useState<DraftWorkOrderMaterial[]>([]);
  const [hydratedWorkOrderId, setHydratedWorkOrderId] = useState<string | null>(null);
  const [savedMaterialsSignature, setSavedMaterialsSignature] = useState<string | null>(null);
  const [savedMaterialCount, setSavedMaterialCount] = useState(0);
  // Read-only observation revision; never part of the persisted Draft payload.
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
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
  const [finishDialogOpen, setFinishDialogOpen] = useState(false);
  const [isFinishConfirming, setIsFinishConfirming] = useState(false);
  const [finishFeedback, setFinishFeedback] = useState<
    { code: string; message: string } | null
  >(null);
  const [actualGoodQuantity, setActualGoodQuantity] = useState("");
  const [materialFocusRequest, setMaterialFocusRequest] = useState<{ productId: string; requestId: number } | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [barcodeFocusRequestId, setBarcodeFocusRequestId] = useState(0);
  const barcodeResolutionInFlight = useRef(false);
  const nextMaterialFocusRequestId = useRef(0);
  const submissionInFlight = useRef(false);
  const deleteSubmissionInFlight = useRef(false);
  const deleteDialogOpenRef = useRef(false);
  const finishDialogOpenRef = useRef(false);
  const finishConfirmationInFlight = useRef(false);

  useEffect(() => {
    setSelectedProjectId(workOrder.projectId ?? "");
    setSavedProjectId(workOrder.projectId ?? "");
    setSavedCustomerName(workOrder.customerName);
    setSavedProjectName(workOrder.projectName);
    setDescription(workOrder.description ?? "");
    setSavedDescription(workOrder.description ?? "");
    setExpectedUpdatedAt(workOrder.updatedAt);
    setMaterials([]);
    setHydratedWorkOrderId(null);
    setSavedMaterialsSignature(null);
    setSavedMaterialCount(0);
    setMaterialFocusRequest(null);
    setBarcodeError(null);
    setBarcodeFocusRequestId(0);
    setSaveFeedback(null);
    setShowRequiredErrors(false);
    setDeleteDialogOpen(false);
    deleteDialogOpenRef.current = false;
    setDeleteDialogError(null);
    setDeleteFeedback(null);
    setFinishDialogOpen(false);
    finishDialogOpenRef.current = false;
    finishConfirmationInFlight.current = false;
    setIsFinishConfirming(false);
    setFinishFeedback(null);
    setActualGoodQuantity("");
  }, [workOrder.id]);

  useEffect(() => {
    if (materialsReady && hydratedWorkOrderId !== workOrder.id) {
      const hydratedMaterials = persistedMaterials.map((material) => ({ ...material }));
      setMaterials(hydratedMaterials);
      setSavedMaterialsSignature(materialSignature(hydratedMaterials));
      setSavedMaterialCount(hydratedMaterials.length);
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
  const hasUnsavedChanges = !materialsHydrated ||
    selectedProjectId !== savedProjectId ||
    description !== savedDescription ||
    materialSignature(materials) !== savedMaterialsSignature;
  const normalizedActualGood = productionContext
    ? normalizeActualGoodQuantity(actualGoodQuantity, productionContext.plannedQuantity)
    : undefined;
  const savedDraftIsFinishComplete = productionContext
    ? Boolean(savedDescription.trim() && materialsHydrated && normalizedActualGood !== null)
    : Boolean(savedProjectId && savedDescription.trim() && savedMaterialCount > 0);
  const interactionBlocked = isSaving || isDeleting || isFinishing ||
    isFinishConfirming ||
    deleteDialogOpen || finishDialogOpen;
  const editingDisabled = interactionBlocked || !materialsHydrated;

  async function handleSave() {
    if (
      submissionInFlight.current || deleteSubmissionInFlight.current ||
      finishConfirmationInFlight.current || deleteDialogOpenRef.current ||
      finishDialogOpenRef.current || isSaving || isDeleting ||
      isFinishing || isFinishConfirming || !canEdit ||
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
        const normalizedDescription = submission.description.trim();
        setDescription(normalizedDescription);
        setSavedDescription(normalizedDescription);
        setSavedProjectId(submission.projectId ?? "");
        setSavedProjectName(selectedChoice?.name ??
          (submission.projectId === workOrder.projectId ? workOrder.projectName : null));
        setSavedCustomerName(selectedChoice?.customerName ??
          (submission.projectId === workOrder.projectId ? workOrder.customerName : null));
        setSavedMaterialsSignature(materialSignature(submission.materials));
        setSavedMaterialCount(submission.materials.length);
        setExpectedUpdatedAt(result.value.updatedAt);
        setAvailabilityRevision(current => current + 1);
        setShowRequiredErrors(false);
        setSaveFeedback({ kind: "success", message: "Draft saved." });
        setFinishFeedback(null);
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
    if (
      isReloading || isDeleting || isSaving || isFinishing ||
      isFinishConfirming ||
      deleteDialogOpenRef.current || finishDialogOpenRef.current
    ) return;
    setIsReloading(true);
    try {
      const result = await onReloadLatest();
      if (result.ok) {
        setSelectedProjectId(result.detail.projectId ?? "");
        setSavedProjectId(result.detail.projectId ?? "");
        setSavedCustomerName(result.detail.customerName);
        setSavedProjectName(result.detail.projectName);
        setDescription(result.detail.description ?? "");
        setSavedDescription(result.detail.description ?? "");
        setExpectedUpdatedAt(result.detail.updatedAt);
        const reloadedMaterials = result.materials.map((material) => ({ ...material }));
        setMaterials(reloadedMaterials);
        setSavedMaterialsSignature(materialSignature(reloadedMaterials));
        setSavedMaterialCount(reloadedMaterials.length);
        setHydratedWorkOrderId(result.detail.id);
        setSaveFeedback(null);
        setDeleteFeedback(null);
        setFinishFeedback(null);
        setDeleteDialogOpen(false);
        deleteDialogOpenRef.current = false;
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
        setMaterials((current) => current.some((item) =>
          item.productId === result.value.productId &&
          item.sourceType === "manual"
        )
          ? current
          : [...current, {
            ...result.value,
            quantity: "",
            sourceType: "manual" as const,
          }]);
        nextMaterialFocusRequestId.current += 1;
        setMaterialFocusRequest({ productId: result.value.productId, requestId: nextMaterialFocusRequestId.current });
      } else {
        setBarcodeError(result.error.message);
        setBarcodeFocusRequestId((current) => current + 1);
      }
    } catch {
      setBarcodeError("The Product could not be resolved. Please try again.");
      setBarcodeFocusRequestId((current) => current + 1);
    } finally {
      barcodeResolutionInFlight.current = false;
    }
  }

  async function handleDeleteConfirm() {
    if (
      deleteSubmissionInFlight.current || submissionInFlight.current ||
      finishConfirmationInFlight.current || finishDialogOpenRef.current ||
      isDeleting || isSaving || isFinishing || isFinishConfirming
    ) return;
    deleteSubmissionInFlight.current = true;
    setDeleteDialogError(null);
    setDeleteFeedback(null);
    try {
      const result = await onDelete(expectedUpdatedAt);
      if (result.ok) {
        setDeleteDialogOpen(false);
        deleteDialogOpenRef.current = false;
        return;
      }

      if (
        result.error.code === "draft_delete_failed" ||
        result.error.code === "invalid_delete_request"
      ) {
        setDeleteDialogError(result.error.message);
      } else {
        setDeleteDialogOpen(false);
        deleteDialogOpenRef.current = false;
        setDeleteFeedback(result.error);
      }
    } catch {
      setDeleteDialogError("The Draft could not be deleted. Please try again.");
    } finally {
      deleteSubmissionInFlight.current = false;
    }
  }

  function openFinishDialog() {
    if (
      !canFinish || !materialsHydrated || !savedDraftIsFinishComplete ||
      hasUnsavedChanges || interactionBlocked ||
      submissionInFlight.current || deleteSubmissionInFlight.current ||
      finishConfirmationInFlight.current
    ) return;
    setFinishFeedback(null);
    finishDialogOpenRef.current = true;
    setFinishDialogOpen(true);
  }

  async function handleFinishConfirm() {
    if (
      !finishDialogOpenRef.current || finishConfirmationInFlight.current ||
      submissionInFlight.current || deleteSubmissionInFlight.current ||
      isSaving || isDeleting || isFinishing || !materialsHydrated ||
      !savedDraftIsFinishComplete || hasUnsavedChanges
    ) return;
    finishConfirmationInFlight.current = true;
    setIsFinishConfirming(true);
    try {
      const result = productionContext
        ? await onFinishConfirm(expectedUpdatedAt, normalizedActualGood ?? undefined)
        : await onFinishConfirm(expectedUpdatedAt);
      if (!result.ok) setFinishFeedback(result.error);
    } catch {
      setFinishFeedback({
        code: "finish_failed",
        message: "The Work Order could not be finished. Please try again.",
      });
    } finally {
      finishConfirmationInFlight.current = false;
      finishDialogOpenRef.current = false;
      setIsFinishConfirming(false);
      setFinishDialogOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      {productionContext ? <PcbWorkOrderOverview workOrder={workOrder} productionContext={productionContext} /> : <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-zinc-900">Draft details</h2>
        {canEdit && !productionContext ? (
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
            <div className="lg:col-span-2"><label htmlFor="work-order-description" className="block text-sm font-semibold text-zinc-800">Short Description</label><textarea id="work-order-description" value={description} disabled={editingDisabled} onChange={(event) => { setDescription(event.target.value); setSaveFeedback(null); }} rows={4} className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100" /></div>
          </form>
        ) : (
          <dl className="mt-6 grid gap-6 sm:grid-cols-2"><ReadOnlyValue label="Project" value={workOrder.projectName ?? "Not selected"} /><ReadOnlyValue label="Customer" value={workOrder.customerName} /><div className="sm:col-span-2"><ReadOnlyValue label="Short Description" value={workOrder.description} /></div></dl>
        )}
      </section>}

      <section aria-labelledby="work-order-materials-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="work-order-materials-heading" className="text-xl font-bold text-zinc-900">Materials</h2>
        {materialsLoading ? <div className="mt-6"><LoadingState message="Loading Draft materials..." /></div> : materialsError ? <div className="mt-6"><ErrorState title="Unable to load Materials" message={materialsError} onRetry={onRetryMaterials} /></div> : materialsHydrated ? (
          <>
            {canEdit && <div className="mt-6 space-y-2">{productionContext && <p className="text-sm text-zinc-600">BOM materials are locked. Additional materials may be added.</p>}<WorkOrderBarcodeScanInput disabled={isLoadingMaterial || editingDisabled} focusRequestId={barcodeFocusRequestId} onScan={(serial) => void handleBarcodeScan(serial)} refocusOnEnable={false} /></div>}
            {isLoadingMaterial && <p role="status" className="mt-4 text-sm text-zinc-600">Loading material...</p>}
            {barcodeError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{barcodeError}</p>}
            <WorkOrderMaterialsAvailability workOrderId={workOrder.id} version={expectedUpdatedAt} revision={`${availabilityRevision}:${materialSignature(materials)}`} unsaved={materialSignature(materials) !== savedMaterialsSignature} focusRequest={materialFocusRequest} materials={materials} onQuantityChange={(productId, sourceType, quantity) => { setMaterials((current) => current.map((item) => item.productId === productId && item.sourceType === sourceType ? { ...item, quantity } : item)); setSaveFeedback(null); }} onRemove={(productId, sourceType) => { setMaterials((current) => current.filter((item) => item.productId !== productId || item.sourceType !== sourceType)); setSaveFeedback(null); }} showSource={Boolean(productionContext)} readOnly={!canEdit} disabled={editingDisabled} showRequiredErrors={showRequiredErrors} emptyDescription={productionContext ? "This PCB production Draft has no BOM or supplemental input materials. Finish will add only the actual completed PCB quantity to Inventory." : undefined} />
          </>
        ) : materialsReady ? <div className="mt-6"><LoadingState message="Preparing Draft materials..." /></div> : null}
      </section>

      {(canEdit || canDelete || canFinish || saveFeedback || deleteFeedback || finishFeedback) && <section aria-label="Draft actions" className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        {saveFeedback?.kind === "success" && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{saveFeedback.message}</p>}
        {saveFeedback?.kind === "error" && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-medium text-red-700">{saveFeedback.message}</p>{saveFeedback.code === "stale_work_order" && <button type="button" disabled={isReloading} onClick={() => void handleReloadLatest()} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">{isReloading ? "Reloading..." : "Reload latest Draft"}</button>}</div>}
        {deleteFeedback && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-medium text-red-700">{deleteFeedback.message}</p>{deleteFeedback.code === "stale_work_order" && <button type="button" disabled={isReloading || isDeleting} onClick={() => void handleReloadLatest()} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">{isReloading ? "Reloading..." : "Reload latest Draft"}</button>}</div>}
        {finishFeedback && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-medium text-red-700">{finishFeedback.message}</p>{finishFeedback.code === "stale_work_order" && <button type="button" disabled={isReloading || interactionBlocked} onClick={() => void handleReloadLatest()} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">{isReloading ? "Reloading..." : "Reload latest Draft"}</button>}</div>}
        {canFinish && hasUnsavedChanges && materialsHydrated && <p className="text-sm font-medium text-amber-700">Save Draft changes before finishing.</p>}
        {canFinish && productionContext && <label className="block max-w-sm text-sm font-semibold text-zinc-800">
          Actual successfully completed quantity
          <input type="text" inputMode="numeric" value={actualGoodQuantity}
            disabled={interactionBlocked || !materialsHydrated}
            onChange={(event) => { setActualGoodQuantity(event.target.value); setFinishFeedback(null); }}
            aria-describedby="actual-good-help"
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm disabled:bg-zinc-100" />
          <span id="actual-good-help" className="mt-2 block font-normal text-zinc-500">
            Planned: {productionContext.plannedQuantity}. Enter a whole number from 0 through the planned quantity.
          </span>
        </label>}
        {canFinish && materialsHydrated && !hasUnsavedChanges && !savedDraftIsFinishComplete && <p className="text-sm font-medium text-amber-700">
          {productionContext
            ? "Enter the actual successfully completed quantity before finishing."
            : "Add a Project, Description, and at least one material, then save the Draft before finishing."}
        </p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {canDelete ? <button type="button" disabled={interactionBlocked} onClick={() => { if (finishDialogOpenRef.current || finishConfirmationInFlight.current) return; deleteDialogOpenRef.current = true; setDeleteFeedback(null); setDeleteDialogError(null); setDeleteDialogOpen(true); }} className="rounded-xl border border-red-300 bg-white px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">Delete Draft</button> : <span />}
          <div className="flex flex-col gap-3 sm:flex-row">
            {canEdit && <button type="button" onClick={() => void handleSave()} disabled={interactionBlocked || !materialsHydrated} className="rounded-xl border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60">{isSaving ? "Saving..." : "Save for Later"}</button>}
            {canFinish && <button type="button" disabled={interactionBlocked || !materialsHydrated || hasUnsavedChanges || !savedDraftIsFinishComplete} onClick={openFinishDialog} className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60">Finish Work Order</button>}
          </div>
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
          deleteDialogOpenRef.current = false;
          setDeleteDialogError(null);
        }}
        onConfirm={() => void handleDeleteConfirm()}
      />

      <WorkOrderFinishDialog
        open={finishDialogOpen && canFinish}
        workOrderNumber={workOrder.workOrderNumber}
        projectName={savedProjectName ?? "Not selected"}
        materialCount={savedMaterialCount}
        plannedQuantity={productionContext?.plannedQuantity}
        actualGoodQuantity={productionContext ? normalizedActualGood ?? undefined : undefined}
        isConfirming={isFinishConfirming || isFinishing}
        onCancel={() => {
          if (isFinishConfirming || isFinishing) return;
          finishDialogOpenRef.current = false;
          setFinishDialogOpen(false);
        }}
        onConfirm={() => void handleFinishConfirm()}
      />
    </div>
  );
}

export default WorkOrderDraftShell;
