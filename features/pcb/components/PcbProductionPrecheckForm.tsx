import { useEffect, useRef, useState } from "react";
import EmptyState from "../../../shared/components/EmptyState";
import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import { buildPcbProductionPreview } from "../domain/buildPcbProductionPreview";
import type { ProductionSubmission } from "../hooks/usePcbProduction";
import type { ProducePcbResult } from "../services/pcbProductionService";
import type { PcbProductionProjectChoice, PcbProductionSource } from "../services/pcbProductionPrecheckService";

interface Props {
  source: PcbProductionSource;
  projects: PcbProductionProjectChoice[];
  isRefreshing: boolean;
  submit: (submission: ProductionSubmission) => Promise<ProducePcbResult>;
  onProduced: (summary: { runId: string; cardName: string; quantity: string; projectName: string | null }) => void;
}

const statusLabels = { planned: "Planned", in_progress: "In Progress", on_hold: "On Hold" };

export default function PcbProductionPrecheckForm({ source, projects, isRefreshing, submit, onProduced }: Props) {
  const [quantity, setQuantity] = useState("");
  const [projectId, setProjectId] = useState("");
  const [confirmation, setConfirmation] = useState<{ quantity: string; projectId: string | null;
    projectName: string | null; affectedProductIds: string[] } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionLocked = useRef(false);
  const preview = quantity === "" ? null : buildPcbProductionPreview(source.inputs, quantity, source.outputIsActive);
  const selectedProject = projects.find((project) => project.projectId === projectId);
  const canConfirm = preview?.ok === true && preview.ready && !isRefreshing &&
    (projectId === "" || Boolean(selectedProject)) && !isSubmitting;

  useEffect(() => { setConfirmation(null); }, [source]);

  async function confirmProduction() {
    if (!confirmation || submissionLocked.current || isRefreshing || !preview?.ok || !preview.ready ||
      quantity !== confirmation.quantity || (projectId || null) !== confirmation.projectId ||
      (projectId !== "" && selectedProject?.name !== confirmation.projectName)) return;
    submissionLocked.current = true;
    setIsSubmitting(true);
    try {
      const result = await submit({ pcbCardId: source.cardId,
        quantityToProduce: confirmation.quantity, projectId: confirmation.projectId,
        affectedProductIds: confirmation.affectedProductIds });
      if (result.ok) {
        onProduced({ runId: result.value.runId, cardName: source.cardName, quantity: confirmation.quantity,
          projectName: confirmation.projectName });
      } else {
        setErrorMessage(result.error.message);
        setQuantity("");
      }
    } catch {
      setErrorMessage("Production status could not be confirmed. Review refreshed stock before trying again.");
      setQuantity("");
    } finally {
      setConfirmation(null);
      setIsSubmitting(false);
      submissionLocked.current = false;
    }
  }

  function openConfirmation() {
    if (!canConfirm || !preview?.ok || !preview.ready) return;
    setErrorMessage(null);
    setConfirmation({ quantity, projectId: projectId || null, projectName: selectedProject?.name ?? null,
      affectedProductIds: [...source.inputs.map((input) => input.productId), source.outputProductId] });
  }

  return <div className="space-y-6">
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-zinc-800">Quantity to Produce
          <input type="text" inputMode="numeric" value={quantity} disabled={isSubmitting || Boolean(confirmation)}
            onChange={(event) => { setQuantity(event.target.value); setErrorMessage(null); }}
            className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2" aria-describedby="quantity-help" />
        </label>
        <label className="block text-sm font-semibold text-zinc-800">Project (optional)
          <select value={projectId} disabled={isSubmitting || Boolean(confirmation)}
            onChange={(event) => { setProjectId(event.target.value); setErrorMessage(null); }}
            className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2">
            <option value="">No Project / General stock</option>
            {projects.map((project) => <option key={project.projectId} value={project.projectId}>
              {project.name} — {statusLabels[project.status]}
            </option>)}
          </select>
        </label>
      </div>
      <p id="quantity-help" className="mt-3 text-sm text-zinc-500">
        Enter a positive whole number to preview requirements. Stock may change before production.
      </p>
      {errorMessage && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {errorMessage}
      </p>}
    </section>

    {!source.outputIsActive && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      The PCB output Product is archived and unavailable for production.
    </p>}
    {source.inputs.length === 0 && <p className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
      This active BOM has no input Products. Production will add only the finished PCB quantity to Inventory.
    </p>}
    {!preview && source.inputs.length > 0 && <EmptyState title="Enter quantity" description="Requirements will appear after you enter Quantity to Produce." />}
    {preview && !preview.ok && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {preview.code === "overflow" ? "Required quantity exceeds the supported whole-number range."
        : preview.code === "invalid_source" ? "Inventory quantity could not be verified."
          : "Enter a positive whole-number quantity within the supported range."}
    </p>}
    {preview?.ok && source.inputs.length > 0 && <section className="space-y-4">
      <h2 className="text-lg font-bold text-zinc-900">Requirements</h2>
      <div className="overflow-x-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600"><tr>
            <th className="px-5 py-4">Component</th><th className="px-5 py-4">Qty per Card</th>
            <th className="px-5 py-4">Required</th><th className="px-5 py-4">Available</th>
            <th className="px-5 py-4">Missing</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">{preview.rows.map((row) =>
            <tr key={row.productId} className={row.missingQuantity !== "0" || !row.isActive ? "bg-amber-50" : ""}>
              <td className="px-5 py-4 font-semibold">{row.name} <span className="font-mono text-xs text-zinc-500">{row.serialNumber}</span>
                {!row.isActive && <span className="ml-2 text-amber-900">Archived / unavailable</span>}</td>
              <td className="px-5 py-4">{row.quantityPerCard}</td><td className="px-5 py-4">{row.requiredQuantity}</td>
              <td className="px-5 py-4">{row.availableQuantity}</td><td className="px-5 py-4">{row.missingQuantity}</td>
            </tr>)}</tbody>
        </table>
      </div>
      {preview.insufficient && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Production cannot be completed because Inventory is insufficient.
      </p>}
      {preview.ready && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Current physical stock meets the previewed requirements. Final stock will be checked during production.
      </p>}
    </section>}
    <button type="button" onClick={openConfirmation} disabled={!canConfirm}
      className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
      Confirm Production
    </button>
    <ConfirmDialog open={Boolean(confirmation)}
      title={`Produce ${confirmation?.quantity ?? ""} × ${source.cardName}?`}
      description={`This will deduct BOM components and add ${confirmation?.quantity ?? ""} ${source.cardName} cards to Inventory.${confirmation?.projectName ? ` Project: ${confirmation.projectName}.` : " General Stock."}`}
      confirmLabel="Confirm Production" onConfirm={() => void confirmProduction()}
      onCancel={() => { if (!isSubmitting) setConfirmation(null); }} isSubmitting={isSubmitting} />
  </div>;
}
