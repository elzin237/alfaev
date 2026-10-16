import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import type { ProjectStatus } from "../projectStatus";
import { useProjectPlanning } from "../hooks/useProjectPlanning";
import type {
  PlanningProductChoice,
  PlanningResult,
  ProjectPlanningGroup,
  ProjectRequirement,
} from "../services/projectPlanningService";

type MutationResult = PlanningResult<{ id: string }>;
type GroupEditor =
  | { mode: "create" }
  | { mode: "edit"; group: ProjectPlanningGroup };
type RequirementEditor =
  | { mode: "create"; group: ProjectPlanningGroup }
  | { mode: "edit"; group: ProjectPlanningGroup; requirement: ProjectRequirement };
type RemoveTarget =
  | { kind: "group"; id: string; label: string }
  | { kind: "requirement"; id: string; label: string };

const buttonClass =
  "rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300";
const primaryClass =
  "rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-60";
const inputClass =
  "mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";
const compactActionClass =
  "whitespace-nowrap rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300";

function kindLabel(kind: ProjectRequirement["productKind"]): string {
  return kind === "pcb_finished_good" ? "Finished PCB Product" : "Component";
}

function requirementCountLabel(count: number): string {
  return `${count} ${count === 1 ? "requirement" : "requirements"}`;
}

function RequirementSummary({ requirements }: {
  requirements: ProjectRequirement[];
}) {
  const hasInventoryContext = requirements.length > 0 &&
    requirements.every((requirement) => requirement.inventoryContext !== null);
  const shortages = hasInventoryContext
    ? requirements.filter(
        (requirement) => requirement.inventoryContext!.availableAfterCommitments < 0n,
      ).length
    : null;

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
      <span>Requirements: {requirements.length}</span>
      {shortages !== null && (
        <>
          <span>Shortages: {shortages}</span>
          <span>Covered: {requirements.length - shortages}</span>
        </>
      )}
    </div>
  );
}

function RequirementsTable({
  group,
  canManage,
  onEdit,
  onRemove,
}: {
  group: ProjectPlanningGroup;
  canManage: boolean;
  onEdit: (requirement: ProjectRequirement) => void;
  onRemove: (requirement: ProjectRequirement) => void;
}) {
  return (
    <div
      data-testid={`requirements-scroll-${group.id}`}
      className="mt-4 max-h-[28rem] max-w-full overflow-auto rounded-2xl border border-zinc-200"
    >
      <table className="min-w-[78rem] divide-y divide-zinc-200 text-sm">
        <caption className="sr-only">Requirements for {group.name}</caption>
        <thead className="sticky top-0 z-10 bg-zinc-50">
          <tr>
            {[
              "Serial Number", "Product", "Kind", "Category", "Brand",
              "Required", "Physical Quantity", "Committed to Projects",
              "Available After Commitments", "Shortage",
              ...(canManage ? ["Actions"] : []),
            ].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {group.requirements.map((requirement) => {
            const context = requirement.inventoryContext;
            const shortage = context && context.availableAfterCommitments < 0n
              ? -context.availableAfterCommitments
              : 0n;
            return (
              <tr key={requirement.id} className="text-zinc-700">
                <th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-mono font-semibold text-zinc-900">
                  {requirement.serialNumber}
                </th>
                <td className="px-3 py-3 font-semibold text-zinc-900">
                  {requirement.productName}
                </td>
                <td className="whitespace-nowrap px-3 py-3">{kindLabel(requirement.productKind)}</td>
                <td className="px-3 py-3">{context?.category ?? "Unavailable"}</td>
                <td className="px-3 py-3">{context ? context.brandName ?? "—" : "Unavailable"}</td>
                <td className="whitespace-nowrap px-3 py-3 font-semibold tabular-nums text-zinc-900">
                  {requirement.requiredQuantity.toString()}
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                  {context?.physicalQuantity.toString() ?? "Unavailable"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                  {context?.committedToProjects.toString() ?? "Unavailable"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                  {context?.availableAfterCommitments.toString() ?? "Unavailable"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                  {context ? shortage > 0n ? (
                    <span className="inline-flex rounded-lg bg-red-50 px-2 py-1 font-semibold text-red-700">
                      Shortage: {shortage.toString()}
                    </span>
                  ) : "None" : "Unavailable"}
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={compactActionClass}
                        onClick={() => onEdit(requirement)}
                      >
                        Edit Requirement
                      </button>
                      <button
                        type="button"
                        className={compactActionClass}
                        onClick={() => onRemove(requirement)}
                      >
                        Remove Requirement
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupDialog({
  editor,
  onClose,
  onSubmit,
  onSucceeded,
}: {
  editor: GroupEditor;
  onClose: () => void;
  onSubmit: (name: string) => Promise<MutationResult>;
  onSucceeded: () => void;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lockRef = useRef(false);
  const [name, setName] = useState(
    editor.mode === "edit" ? editor.group.name : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockRef.current) return;
    const normalized = name.trim();
    if (!normalized) {
      setError("Name is required.");
      return;
    }
    lockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(normalized);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onSucceeded();
      onClose();
    } catch {
      setError("The Project plan could not be changed. Please try again.");
    } finally {
      lockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={submitting}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) onClose();
        }}
        className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-xl font-bold text-zinc-900">
          {editor.mode === "create" ? "Add Product" : "Rename Project Product"}
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          This is a Project deliverable grouping, not an Inventory Product.
        </p>
        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
          <div>
            <label htmlFor="planning-group-name" className="text-sm font-semibold text-zinc-800">
              Name
            </label>
            <input
              ref={inputRef}
              id="planning-group-name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(error)}
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" className={buttonClass} disabled={submitting} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryClass} disabled={submitting}>
              {submitting ? "Saving…" : editor.mode === "create" ? "Add Product" : "Save Name"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RequirementDialog({
  editor,
  choices,
  choicesPending,
  choicesError,
  onRetryChoices,
  search,
  onSearch,
  onClose,
  onSubmit,
  onSucceeded,
}: {
  editor: RequirementEditor;
  choices: PlanningProductChoice[];
  choicesPending: boolean;
  choicesError: string | null;
  onRetryChoices: () => void;
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSubmit: (productId: string, quantity: number) => Promise<MutationResult>;
  onSucceeded: () => void;
}) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const lockRef = useRef(false);
  const [productId, setProductId] = useState(
    editor.mode === "edit" ? editor.requirement.productId : "",
  );
  const [quantity, setQuantity] = useState(
    editor.mode === "edit" ? String(editor.requirement.requiredQuantity) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const current = editor.mode === "edit" ? editor.requirement : null;
  const showHistoricalChoice = current &&
    !choices.some((choice) => choice.productId === current.productId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockRef.current) return;
    const parsed = Number(quantity);
    if (!productId) {
      setError("Select a Product.");
      return;
    }
    if (!/^[1-9][0-9]*$/.test(quantity) ||
      !Number.isSafeInteger(parsed)) {
      setError("Required Quantity must be a positive whole number.");
      return;
    }
    lockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(productId, parsed);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onSucceeded();
      onClose();
    } catch {
      setError("The requirement could not be saved. Please try again.");
    } finally {
      lockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={submitting}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) onClose();
        }}
        className="w-full max-w-xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-xl font-bold text-zinc-900">
          {editor.mode === "create" ? "Add Requirement" : "Edit Requirement"}
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          Plan a required Product for {editor.group.name}. No stock is changed.
        </p>
        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
          <div>
            <label htmlFor="planning-product-search" className="text-sm font-semibold text-zinc-800">
              Search Products by Name or Serial Number
            </label>
            <input
              ref={searchRef}
              id="planning-product-search"
              className={inputClass}
              value={search}
              onChange={(event) => {
                if (productId !== current?.productId) setProductId("");
                onSearch(event.target.value);
              }}
              disabled={submitting}
            />
          </div>
          <div>
            <label htmlFor="planning-product-choice" className="text-sm font-semibold text-zinc-800">
              Product
            </label>
            <select
              id="planning-product-choice"
              className={inputClass}
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              disabled={submitting || choicesPending || Boolean(choicesError)}
            >
              <option value="">Select a Product</option>
              {showHistoricalChoice && (
                <option value={current.productId}>
                  {current.serialNumber} — {current.productName} (current historical Product)
                </option>
              )}
              {choices.map((choice) => (
                <option key={choice.productId} value={choice.productId}>
                  {choice.serialNumber} — {choice.name} ({kindLabel(choice.productKind)})
                </option>
              ))}
            </select>
            {choicesPending && <p role="status" className="mt-2 text-sm text-zinc-500">Loading Product choices...</p>}
            {choicesError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {choicesError}{" "}
                <button type="button" className="underline" onClick={onRetryChoices}>Try again</button>
              </p>
            )}
          </div>
          <div>
            <label htmlFor="planning-required-quantity" className="text-sm font-semibold text-zinc-800">
              Required Quantity
            </label>
            <input
              id="planning-required-quantity"
              className={inputClass}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={submitting}
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" className={buttonClass} disabled={submitting} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryClass} disabled={submitting || choicesPending || Boolean(choicesError)}>
              {submitting ? "Saving…" : "Save Requirement"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ProjectPlanningSection({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  const [groupEditor, setGroupEditor] = useState<GroupEditor | null>(null);
  const [requirementEditor, setRequirementEditor] =
    useState<RequirementEditor | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const removeLockRef = useRef(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [choiceSearch, setChoiceSearch] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const planning = useProjectPlanning(
    projectId, status, requirementEditor !== null, choiceSearch,
  );
  const { planningQuery, choicesQuery, canManage } = planning;
  const groups = planningQuery.data?.ok ? planningQuery.data.value : [];
  const choices = choicesQuery.data?.ok ? choicesQuery.data.value : [];
  const choicesError = choicesQuery.isError
    ? "Product choices could not be loaded."
    : choicesQuery.data?.ok === false
      ? choicesQuery.data.error.message
      : null;

  function openRequirement(editor: RequirementEditor) {
    setChoiceSearch("");
    setSuccess(null);
    setRequirementEditor(editor);
  }

  function toggleRequirements(groupId: string) {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function removeRequirementTarget(requirement: ProjectRequirement) {
    setRemoveError(null);
    setRemoveTarget({
      kind: "requirement",
      id: requirement.id,
      label: requirement.serialNumber + " " + requirement.productName,
    });
  }

  async function confirmRemove() {
    if (!removeTarget || removeLockRef.current) return;
    removeLockRef.current = true;
    setRemovePending(true);
    setRemoveError(null);
    try {
      const result = removeTarget.kind === "group"
        ? await planning.removeGroup(removeTarget.id)
        : await planning.removeRequirement(removeTarget.id);
      if (!result.ok) {
        setRemoveError(result.error.message);
        return;
      }
      setSuccess(removeTarget.kind === "group"
        ? "Project Product removed."
        : "Requirement removed.");
      setRemoveTarget(null);
    } catch {
      setRemoveError("The planning record could not be removed. Please try again.");
    } finally {
      removeLockRef.current = false;
      setRemovePending(false);
    }
  }

  return (
    <section aria-label="Products" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Products</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Project deliverables and their planned Product requirements.
          </p>
        </div>
        {canManage && (
          <button type="button" className={primaryClass} onClick={() => {
            setSuccess(null);
            setGroupEditor({ mode: "create" });
          }}>
            Add Product
          </button>
        )}
      </div>
      {success && <p role="status" className="text-sm font-medium text-emerald-700">{success}</p>}

      {planningQuery.isPending ? (
        <LoadingState message="Loading Project Products..." />
      ) : planningQuery.isError || !planningQuery.data?.ok ? (
        <ErrorState
          title="Unable to load Project Products"
          message={planningQuery.data?.ok === false
            ? planningQuery.data.error.message
            : "The Project plan could not be loaded. Please try again."}
          onRetry={() => void planningQuery.refetch()}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No Project Products yet"
          description="Add a Project deliverable, then plan its required stock Products."
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <article key={group.id} className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-zinc-900">{group.name}</h3>
                  <RequirementSummary requirements={group.requirements} />
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass} onClick={() => openRequirement({ mode: "create", group })}>
                      Add Requirement
                    </button>
                    <button type="button" className={buttonClass} onClick={() => setGroupEditor({ mode: "edit", group })}>
                      Rename
                    </button>
                    <button type="button" className={buttonClass} onClick={() => {
                      setRemoveError(null);
                      setRemoveTarget({ kind: "group", id: group.id, label: group.name });
                    }}>
                      Remove Product
                    </button>
                  </div>
                )}
              </div>
              {group.requirements.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">
                  No component requirements planned for this Project Product.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    aria-expanded={expandedGroupIds.has(group.id)}
                    aria-controls={`project-requirements-${group.id}`}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                    onClick={() => toggleRequirements(group.id)}
                  >
                    {expandedGroupIds.has(group.id) ? (
                      <ChevronUp aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    )}
                    {expandedGroupIds.has(group.id)
                      ? "Hide requirements"
                      : `Show ${requirementCountLabel(group.requirements.length)}`}
                  </button>
                  {expandedGroupIds.has(group.id) && (
                    <div id={`project-requirements-${group.id}`}>
                      <RequirementsTable
                        group={group}
                        canManage={canManage}
                        onEdit={(requirement) => openRequirement({ mode: "edit", group, requirement })}
                        onRemove={removeRequirementTarget}
                      />
                    </div>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {groupEditor && canManage && (
        <GroupDialog
          key={groupEditor.mode === "edit" ? groupEditor.group.id : "new"}
          editor={groupEditor}
          onClose={() => setGroupEditor(null)}
          onSubmit={(name) => groupEditor.mode === "create"
            ? planning.createGroup(name)
            : planning.updateGroup(groupEditor.group.id, name)}
          onSucceeded={() => setSuccess(groupEditor.mode === "create"
            ? "Project Product added."
            : "Project Product renamed.")}
        />
      )}
      {requirementEditor && canManage && (
        <RequirementDialog
          key={requirementEditor.mode === "edit" ? requirementEditor.requirement.id : requirementEditor.group.id}
          editor={requirementEditor}
          choices={choices}
          choicesPending={choicesQuery.isPending}
          choicesError={choicesError}
          onRetryChoices={() => void choicesQuery.refetch()}
          search={choiceSearch}
          onSearch={setChoiceSearch}
          onClose={() => setRequirementEditor(null)}
          onSubmit={(productId, quantity) => requirementEditor.mode === "create"
            ? planning.createRequirement(requirementEditor.group.id, productId, quantity)
            : planning.updateRequirement(requirementEditor.requirement.id, productId, quantity)}
          onSucceeded={() => setSuccess(requirementEditor.mode === "create"
            ? "Requirement added."
            : "Requirement updated.")}
        />
      )}
      <ConfirmDialog
        open={removeTarget !== null && canManage}
        title={removeTarget?.kind === "group" ? "Remove Project Product" : "Remove Requirement"}
        description={removeTarget?.kind === "group"
          ? `Remove ${removeTarget.label} from this Project plan? Component requirements must be removed individually first.`
          : `Remove ${removeTarget?.label ?? ""} from this Project plan?`}
        confirmLabel={removeTarget?.kind === "group" ? "Remove Product" : "Remove Requirement"}
        confirmVariant="danger"
        isSubmitting={removePending}
        errorMessage={removeError}
        onCancel={() => {
          if (!removePending) setRemoveTarget(null);
        }}
        onConfirm={() => void confirmRemove()}
      />
    </section>
  );
}
