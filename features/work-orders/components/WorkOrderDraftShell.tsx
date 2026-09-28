import { useEffect, useMemo, useRef, useState } from "react";

import EmptyState from "../../../shared/components/EmptyState";
import WorkOrderBarcodeScanInput from "./WorkOrderBarcodeScanInput";
import type {
  WorkOrderDetail,
  ResolvedWorkOrderProduct,
  WorkOrderProductResolutionResult,
  WorkOrderProjectChoice,
  WorkOrderUpdateResult,
} from "../services/workOrderService";

export interface WorkOrderDraftSubmission {
  projectId: string | null;
  description: string;
}

interface WorkOrderDraftShellProps {
  workOrder: WorkOrderDetail;
  canEdit: boolean;
  projectChoices: WorkOrderProjectChoice[];
  projectChoicesError: string | null;
  projectChoicesLoading: boolean;
  isSaving: boolean;
  isResolvingBarcode: boolean;
  onReloadLatest: () => Promise<void>;
  onRetryProjectChoices: () => void;
  onResolveBarcode: (
    serialNumber: string,
  ) => Promise<WorkOrderProductResolutionResult>;
  onSave: (
    submission: WorkOrderDraftSubmission,
  ) => Promise<WorkOrderUpdateResult>;
}

function ReadOnlyValue({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-2 whitespace-pre-wrap text-sm font-medium text-zinc-900">
        {value ?? "Not set"}
      </dd>
    </div>
  );
}

function WorkOrderDraftShell({
  workOrder,
  canEdit,
  projectChoices,
  projectChoicesError,
  projectChoicesLoading,
  isSaving,
  isResolvingBarcode,
  onReloadLatest,
  onRetryProjectChoices,
  onResolveBarcode,
  onSave,
}: WorkOrderDraftShellProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(
    workOrder.projectId ?? "",
  );
  const [description, setDescription] = useState(workOrder.description ?? "");
  const [hasLocalProjectChange, setHasLocalProjectChange] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<
    | { kind: "error"; code: string; message: string }
    | { kind: "success"; message: string }
    | null
  >(null);
  const [isReloading, setIsReloading] = useState(false);
  const [resolvedProduct, setResolvedProduct] = useState<
    ResolvedWorkOrderProduct | null
  >(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const barcodeResolutionInFlight = useRef(false);
  const submissionInFlight = useRef(false);

  useEffect(() => {
    setResolvedProduct(null);
    setBarcodeError(null);
  }, [workOrder.id]);

  useEffect(() => {
    setSelectedProjectId(workOrder.projectId ?? "");
    setDescription(workOrder.description ?? "");
    setHasLocalProjectChange(false);
    setSaveFeedback(null);
  }, [
    workOrder.description,
    workOrder.id,
    workOrder.projectId,
    workOrder.updatedAt,
  ]);

  const selectedChoice = useMemo(
    () => projectChoices.find((choice) => choice.id === selectedProjectId),
    [projectChoices, selectedProjectId],
  );
  const currentProjectIsMissingFromChoices = Boolean(
    workOrder.projectId &&
    !projectChoices.some((choice) => choice.id === workOrder.projectId),
  );
  const customerName = hasLocalProjectChange
    ? selectedChoice?.customerName ?? null
    : workOrder.customerName;

  async function handleSave() {
    if (submissionInFlight.current || isSaving) return;

    submissionInFlight.current = true;
    setSaveFeedback(null);
    const submission = {
      projectId: selectedProjectId || null,
      description,
    };
    try {
      const result = await onSave(submission);
      if (result.ok) {
        setSelectedProjectId(submission.projectId ?? "");
        setDescription(submission.description.trim());
        setHasLocalProjectChange(false);
        setSaveFeedback({ kind: "success", message: "Draft saved." });
      } else {
        setSaveFeedback({
          kind: "error",
          code: result.error.code,
          message: result.error.message,
        });
      }
    } catch {
      setSaveFeedback({
        kind: "error",
        code: "work_order_update_failed",
        message: "The Draft could not be saved. Please try again.",
      });
    } finally {
      submissionInFlight.current = false;
    }
  }

  async function handleReloadLatest() {
    if (isReloading) return;
    setIsReloading(true);
    try {
      await onReloadLatest();
    } finally {
      setIsReloading(false);
    }
  }

  async function handleBarcodeScan(serialNumber: string) {
    if (barcodeResolutionInFlight.current || isResolvingBarcode) return;

    barcodeResolutionInFlight.current = true;
    setResolvedProduct(null);
    setBarcodeError(null);
    try {
      const result = await onResolveBarcode(serialNumber);
      if (result.ok) {
        setResolvedProduct(result.value);
      } else {
        setBarcodeError(result.error.message);
      }
    } catch {
      setBarcodeError("The Product could not be resolved. Please try again.");
    } finally {
      barcodeResolutionInFlight.current = false;
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-zinc-900">Draft details</h2>

        {canEdit ? (
          <form
            id="work-order-draft-form"
            className="mt-6 grid gap-6 lg:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <div>
              <label
                htmlFor="work-order-project"
                className="block text-sm font-semibold text-zinc-800"
              >
                Project
              </label>
              <select
                id="work-order-project"
                value={selectedProjectId}
                disabled={projectChoicesLoading || Boolean(projectChoicesError)}
                onChange={(event) => {
                  const nextProjectId = event.target.value;
                  setSelectedProjectId(nextProjectId);
                  setSaveFeedback(null);
                  setHasLocalProjectChange(
                    nextProjectId !== (workOrder.projectId ?? ""),
                  );
                }}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition disabled:cursor-not-allowed disabled:bg-zinc-100 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="">Not selected</option>
                {currentProjectIsMissingFromChoices && workOrder.projectId && (
                  <option value={workOrder.projectId} disabled>
                    {workOrder.projectName} (current)
                  </option>
                )}
                {projectChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}
                  </option>
                ))}
              </select>

              {projectChoicesLoading && (
                <p role="status" className="mt-2 text-sm text-zinc-500">
                  Loading Project choices...
                </p>
              )}
              {projectChoicesError && (
                <div
                  role="alert"
                  className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4"
                >
                  <p className="text-sm font-medium text-red-700">
                    {projectChoicesError}
                  </p>
                  <button
                    type="button"
                    onClick={onRetryProjectChoices}
                    className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="work-order-customer"
                className="block text-sm font-semibold text-zinc-800"
              >
                Customer
              </label>
              <input
                id="work-order-customer"
                readOnly
                value={customerName ?? "Not set"}
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-700"
              />
            </div>

            <div className="lg:col-span-2">
              <label
                htmlFor="work-order-description"
                className="block text-sm font-semibold text-zinc-800"
              >
                Short Description
              </label>
              <textarea
                id="work-order-description"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSaveFeedback(null);
                }}
                rows={4}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

          </form>
        ) : (
          <dl className="mt-6 grid gap-6 sm:grid-cols-2">
            <ReadOnlyValue label="Project" value={workOrder.projectName ?? "Not selected"} />
            <ReadOnlyValue label="Customer" value={workOrder.customerName} />
            <div className="sm:col-span-2">
              <ReadOnlyValue label="Short Description" value={workOrder.description} />
            </div>
          </dl>
        )}
      </section>

      {canEdit ? (
        <section
          aria-labelledby="work-order-materials-heading"
          className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <h2
            id="work-order-materials-heading"
            className="text-xl font-bold text-zinc-900"
          >
            Materials
          </h2>
          <div className="mt-6">
            <WorkOrderBarcodeScanInput
              disabled={isResolvingBarcode}
              onScan={(serialNumber) => void handleBarcodeScan(serialNumber)}
            />
          </div>
          {isResolvingBarcode && (
            <p role="status" className="mt-4 text-sm text-zinc-600">
              Resolving Product...
            </p>
          )}
          {resolvedProduct && (
            <div
              role="status"
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
            >
              <p className="font-semibold">Resolved Product</p>
              <p className="mt-2">
                Serial Number:{" "}
                <span className="font-mono font-semibold">
                  {resolvedProduct.serialNumber}
                </span>
              </p>
              <p className="mt-1">Name: {resolvedProduct.name}</p>
            </div>
          )}
          {barcodeError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700"
            >
              {barcodeError}
            </p>
          )}
          <p className="mt-4 text-sm leading-6 text-zinc-500">
            Scanned Products will appear here in a later step.
          </p>
        </section>
      ) : (
        <section aria-label="Materials">
          <EmptyState
            title="Materials"
            description="Materials will be added in a later step."
          />
        </section>
      )}

      {(canEdit || saveFeedback) && (
        <section
          aria-label="Draft actions"
          className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm"
        >
          {saveFeedback?.kind === "success" && (
            <p
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800"
            >
              {saveFeedback.message}
            </p>
          )}

          {saveFeedback?.kind === "error" && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4"
            >
              <p className="text-sm font-medium text-red-700">
                {saveFeedback.message}
              </p>
              {saveFeedback.code === "stale_work_order" && (
                <button
                  type="button"
                  disabled={isReloading}
                  onClick={() => void handleReloadLatest()}
                  className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isReloading ? "Reloading..." : "Reload latest Draft"}
                </button>
              )}
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <button
                type="submit"
                form="work-order-draft-form"
                disabled={isSaving}
                className="rounded-xl border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save for Later"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default WorkOrderDraftShell;
