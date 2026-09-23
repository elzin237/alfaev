import { useEffect, useMemo, useState } from "react";

import EmptyState from "../../../shared/components/EmptyState";
import type {
  WorkOrderDetail,
  WorkOrderProjectChoice,
} from "../services/workOrderService";

interface WorkOrderDraftShellProps {
  workOrder: WorkOrderDetail;
  canEdit: boolean;
  projectChoices: WorkOrderProjectChoice[];
  projectChoicesError: string | null;
  projectChoicesLoading: boolean;
  onRetryProjectChoices: () => void;
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
  onRetryProjectChoices,
}: WorkOrderDraftShellProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(
    workOrder.projectId ?? "",
  );
  const [description, setDescription] = useState(workOrder.description ?? "");
  const [hasLocalProjectChange, setHasLocalProjectChange] = useState(false);

  useEffect(() => {
    setSelectedProjectId(workOrder.projectId ?? "");
    setDescription(workOrder.description ?? "");
    setHasLocalProjectChange(false);
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

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-zinc-900">Draft details</h2>

        {canEdit ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
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
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

            <p className="text-sm leading-6 text-zinc-500 lg:col-span-2">
              Project and Description changes are local and are not saved in this step.
            </p>
          </div>
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

      <section aria-label="Materials">
        <EmptyState
          title="Materials"
          description="Materials will be added in a later step."
        />
      </section>
    </div>
  );
}

export default WorkOrderDraftShell;
