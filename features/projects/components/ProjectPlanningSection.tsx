import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import { RequirementProductAutocomplete } from "./RequirementProductAutocomplete";
import type { InventoryCommitment } from "../../inventory/services/inventoryCommitmentService";
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
const postgresBigintMax = "9223372036854775807";
const requirementColumns = [
  { label: "Serial", description: "Product Serial Number." },
  { label: "Product", description: "Product name for this requirement." },
  { label: "Kind", description: "Product kind: Component or Finished PCB Product." },
  { label: "Category", description: "Product category." },
  { label: "Brand", description: "Product brand." },
  { label: "Required", description: "Required quantity for this requirement row in the current Project Product group." },
  { label: "Committed", description: "Committed to Projects (global): outstanding Project demand for components; active hard FG Project reservations for Finished PCB Products. Not specific to this requirement row." },
  { label: "Available", description: "Available After Commitments (global): Raw + Customs physical stock minus outstanding Project demand for components; FG physical stock minus hard FG Project reservations for Finished PCB Products. Before Test holds." },
  { label: "Shortage", description: "Global shared shortage across Projects: outstanding demand minus Raw + Customs physical stock for components, or FG physical stock for Finished PCB Products, never below zero. Not specific to this requirement row." },
];
const requirementNumericClass = "w-24 min-w-24 whitespace-nowrap px-2 py-3 text-center tabular-nums";

function isPositiveBigintQuantity(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value) &&
    (value.length < postgresBigintMax.length ||
      (value.length === postgresBigintMax.length && value <= postgresBigintMax));
}

function kindLabel(kind: ProjectRequirement["productKind"]): string {
  return kind === "pcb_finished_good" ? "Finished PCB Product" : "Component";
}

function requirementCountLabel(count: number): string {
  return `${count} ${count === 1 ? "requirement" : "requirements"}`;
}

function RequirementSummary({ requirements }: {
  requirements: ProjectRequirement[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
      <span>Requirements: {requirements.length}</span>
    </div>
  );
}

function RequirementsTable({
  group,
  finishedGoodsCommitments,
  canManage,
  onEdit,
  onUpdateQuantity,
  onQuantityUpdated,
  onRemove,
}: {
  group: ProjectPlanningGroup;
  finishedGoodsCommitments: InventoryCommitment[] | undefined;
  canManage: boolean;
  onEdit: (requirement: ProjectRequirement) => void;
  onUpdateQuantity: (
    requirement: ProjectRequirement,
    quantity: string,
  ) => Promise<MutationResult>;
  onQuantityUpdated: () => void;
  onRemove: (requirement: ProjectRequirement) => void;
}) {
  const quantityErrorId = useId();
  const columnHelpId = useId();
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const editTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusRequirementIdRef = useRef<string | null>(null);
  const restoreFocusRef = useRef(false);
  const saveLockRef = useRef(false);
  const [editingRequirementId, setEditingRequirementId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editingRequirementId) {
      quantityInputRef.current?.focus();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      if (returnFocusRequirementIdRef.current) {
        editTriggerRefs.current.get(returnFocusRequirementIdRef.current)?.focus();
      }
    }
  }, [editingRequirementId]);

  function beginQuantityEdit(requirement: ProjectRequirement) {
    returnFocusRequirementIdRef.current = requirement.id;
    setEditingRequirementId(requirement.id);
    setQuantity(requirement.requiredQuantity.toString());
    setQuantityError(null);
  }

  function closeQuantityEdit() {
    if (saving) return;
    restoreFocusRef.current = true;
    setEditingRequirementId(null);
    setQuantity("");
    setQuantityError(null);
  }

  async function saveQuantity(
    event: FormEvent<HTMLFormElement>,
    requirement: ProjectRequirement,
  ) {
    event.preventDefault();
    if (saveLockRef.current) return;
    if (!isPositiveBigintQuantity(quantity)) {
      setQuantityError("Required Quantity must be a positive whole number.");
      return;
    }
    saveLockRef.current = true;
    setSaving(true);
    setQuantityError(null);
    try {
      const result = await onUpdateQuantity(requirement, quantity);
      if (!result.ok) {
        setQuantityError(result.error.message);
        return;
      }
      onQuantityUpdated();
      restoreFocusRef.current = true;
      setEditingRequirementId(null);
      setQuantity("");
    } catch {
      setQuantityError("The requirement could not be saved. Please try again.");
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div
      data-testid={`requirements-scroll-${group.id}`}
      className="mt-4 max-h-[28rem] max-w-full overflow-auto rounded-2xl border border-zinc-200"
    >
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <caption className="caption-top px-3 py-2 text-left text-xs text-zinc-600">
          Requirements for {group.name}. Committed to Projects, Available After Commitments and Shortage are global figures across Projects, not this requirement row.
        </caption>
        <thead className="sticky top-0 z-10 bg-zinc-50">
          <tr>
            {[...requirementColumns, ...(canManage ? [{ label: "Actions", description: "Edit or remove this requirement, subject to your permissions." }] : [])].map(({ label, description }, index) => (
              <th
                key={label}
                scope="col"
                aria-label={label}
                aria-describedby={`${columnHelpId}-${index}`}
                className="whitespace-nowrap px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500"
              >
                <span tabIndex={0} title={description} aria-describedby={`${columnHelpId}-${index}`} className="group relative inline-block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500">
                  {label}
                  <span role="tooltip" id={`${columnHelpId}-${index}`} className={`pointer-events-none absolute top-full z-20 mt-2 hidden w-56 rounded-lg bg-zinc-900 px-3 py-2 text-left text-xs font-normal normal-case leading-5 whitespace-normal tracking-normal text-white shadow-lg group-hover:block group-focus:block ${index < 2 ? "left-0" : "right-0"}`}>{description}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {group.requirements.map((requirement) => {
            const context = requirement.inventoryContext;
            const finished = requirement.productKind === "pcb_finished_good";
            const fg = finishedGoodsCommitments?.find(row => row.productId === requirement.productId);
            const committed = finished ? fg?.committedToProjects : context?.committedToProjects;
            const available = finished ? fg?.availableAfterCommitments : context?.availableAfterCommitments;
            // Planning's commitment is global outstanding demand, even for FG.
            // Never substitute its Raw + Customs physical quantity for FG stock.
            const deficit = finished
              ? fg && context ? context.committedToProjects - fg.physicalQuantity : undefined
              : available === undefined ? undefined : -available;
            const shortage = deficit === undefined ? undefined : deficit > 0n ? deficit : 0n;
            return (
              <tr key={requirement.id} className="text-zinc-700">
                <th scope="row" className="w-24 min-w-24 whitespace-nowrap px-2 py-3 text-center font-mono font-semibold text-zinc-900">
                  {requirement.serialNumber}
                </th>
                <td className="min-w-40 max-w-56 px-2 py-3 text-center font-semibold text-zinc-900 [overflow-wrap:anywhere]">
                  {requirement.productName}
                </td>
                <td className="whitespace-nowrap px-2 py-3 text-center">{kindLabel(requirement.productKind)}</td>
                <td className="max-w-40 px-2 py-3 text-center [overflow-wrap:anywhere]">{context?.category ?? "Unavailable"}</td>
                <td className="max-w-40 px-2 py-3 text-center [overflow-wrap:anywhere]">{context ? context.brandName ?? "—" : "Unavailable"}</td>
                <td className={`${requirementNumericClass} font-semibold text-zinc-900`}>
                  {canManage && editingRequirementId === requirement.id ? (
                    <form
                      className="flex min-w-max items-start justify-center gap-2"
                      aria-busy={saving}
                      onSubmit={(event) => void saveQuantity(event, requirement)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !saving) {
                          event.preventDefault();
                          closeQuantityEdit();
                        }
                      }}
                    >
                      <div>
                        <label className="sr-only" htmlFor={`required-quantity-${requirement.id}`}>
                          Required quantity for {requirement.productName}
                        </label>
                        <input
                          ref={quantityInputRef}
                          id={`required-quantity-${requirement.id}`}
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={quantity}
                          disabled={saving}
                          aria-invalid={Boolean(quantityError)}
                          aria-describedby={quantityError ? quantityErrorId : undefined}
                          className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-center text-sm font-semibold tabular-nums outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                          onChange={(event) => {
                            setQuantity(event.target.value);
                            setQuantityError(null);
                          }}
                        />
                        {quantityError && (
                          <p id={quantityErrorId} role="alert" className="mt-1 max-w-56 whitespace-normal text-xs font-normal text-red-700">
                            {quantityError}
                          </p>
                        )}
                      </div>
                      <button type="submit" className={compactActionClass} disabled={saving}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className={compactActionClass} disabled={saving} onClick={closeQuantityEdit}>
                        Cancel
                      </button>
                    </form>
                  ) : canManage ? (
                    <button
                      ref={(node) => {
                        if (node) editTriggerRefs.current.set(requirement.id, node);
                        else editTriggerRefs.current.delete(requirement.id);
                      }}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 font-semibold tabular-nums text-zinc-900 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      aria-label={`Edit required quantity for ${requirement.productName}`}
                      disabled={saving}
                      onClick={() => beginQuantityEdit(requirement)}
                    >
                      {requirement.requiredQuantity.toString()}
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5 text-zinc-500" />
                    </button>
                  ) : requirement.requiredQuantity.toString()}
                </td>
                <td className={requirementNumericClass}>{committed?.toString() ?? "Unavailable"}</td>
                <td className={requirementNumericClass}>{available?.toString() ?? "Unavailable"}</td>
                <td className={requirementNumericClass}>
                  {shortage === undefined ? "Unavailable" : (
                    <span className={shortage > 0n ? "inline-flex rounded-lg bg-red-50 px-2 py-1 font-semibold text-red-700" : undefined}>
                      {shortage.toString()}
                    </span>
                  )}
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-2 py-3 text-center">
                    <div className="flex justify-center gap-2">
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
  onSubmit: (productId: string, quantity: string) => Promise<MutationResult>;
  onSucceeded: () => void;
}) {
  const titleId = useId();
  const lockRef = useRef(false);
  const [productId, setProductId] = useState(
    editor.mode === "edit" ? editor.requirement.productId : "",
  );
  const [quantity, setQuantity] = useState(
    editor.mode === "edit" ? String(editor.requirement.requiredQuantity) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const current = editor.mode === "edit" ? editor.requirement : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockRef.current) return;
    if (!productId) {
      setError("Select a Product.");
      return;
    }
    if (!isPositiveBigintQuantity(quantity)) {
      setError("Required Quantity must be a positive whole number.");
      return;
    }
    lockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(productId, quantity);
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
        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-xl font-bold text-zinc-900">
          {editor.mode === "create" ? "Add Requirement" : "Edit Requirement"}
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          Plan a required Product for {editor.group.name}. No physical stock is changed.
          Finished Goods may be automatically reserved up to outstanding demand.
        </p>
        <form className="mt-6 space-y-5" noValidate onSubmit={(event) => void submit(event)}>
          <RequirementProductAutocomplete
            choices={choices}
            pending={choicesPending}
            error={choicesError}
            onRetry={onRetryChoices}
            search={search}
            onSearch={onSearch}
            initialProduct={current ? {
              productId: current.productId,
              name: current.productName,
              serialNumber: current.serialNumber,
              productKind: current.productKind,
            } : null}
            onSelect={setProductId}
            disabled={submitting}
          />
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
  const { planningQuery, choicesQuery, canManage, finishedGoodsCommitmentsQuery } = planning;
  const finishedGoodsCommitments = !finishedGoodsCommitmentsQuery.isError && finishedGoodsCommitmentsQuery.data?.ok
    ? finishedGoodsCommitmentsQuery.data.value : undefined;
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
      {(planning.requirementRecovery?.pending || planning.requirementRecovery?.error) && <div role="alert"
        className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
        <p>{planning.requirementRecovery.error ?? "A saved Finished Goods requirement request needs reconciliation. Its original UUID and payload are retained."}</p>
        <p>Do not create a replacement request or clear browser data. Return to this account and Project to recover it.</p>
        <button type="button" className={buttonClass} disabled={planning.requirementRecovery.busy}
          onClick={() => void (planning.requirementRecovery.pending ? planning.requirementRecovery.retry() : planning.requirementRecovery.checkRecovery())}>
          {planning.requirementRecovery.pending ? "Retry saved requirement request" : "Check requirement recovery"}
        </button>
      </div>}

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
        <div
          data-testid="project-products-scroll"
          className="max-h-[50rem] max-w-full space-y-4 overflow-x-hidden overflow-y-auto pr-1"
        >
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
                        finishedGoodsCommitments={finishedGoodsCommitments}
                        canManage={canManage}
                        onEdit={(requirement) => openRequirement({ mode: "edit", group, requirement })}
                        onUpdateQuantity={(requirement, quantity) => planning.updateRequirement(
                          requirement.id, requirement.productId, quantity,
                        )}
                        onQuantityUpdated={() => setSuccess("Requirement quantity updated.")}
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
