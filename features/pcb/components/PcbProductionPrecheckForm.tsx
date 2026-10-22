import { useEffect, useRef, useState } from "react";
import EmptyState from "../../../shared/components/EmptyState";
import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import { buildPcbProductionPreview } from "../domain/buildPcbProductionPreview";
import type { ProductionSubmission } from "../hooks/usePcbProduction";
import type { ProducePcbResult } from "../services/pcbProductionService";
import type { PcbProductionSource } from "../services/pcbProductionPrecheckService";

interface Props {
  source: PcbProductionSource;
  isRefreshing: boolean;
  submit: (submission: ProductionSubmission) => Promise<ProducePcbResult>;
  onProduced: (summary: { workOrderId: string; workOrderNumber: string; cardName: string;
    plannedQuantity: string; projectName: string | null }) => void;
}

export default function PcbProductionPrecheckForm({ source, isRefreshing, submit, onProduced }: Props) {
  const [quantity, setQuantity] = useState("");
  const [confirmation, setConfirmation] = useState<{ quantity: string;
    creationRequestId: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionLocked = useRef(false);
  const creationAttempt = useRef<{ quantity: string; requestId: string } | null>(null);
  const preview = quantity === "" ? null : buildPcbProductionPreview(source.inputs, quantity, source.outputIsActive);
  const productsAvailable = source.outputIsActive && source.inputs.every((input) => input.isActive);
  const canConfirm = preview?.ok === true && productsAvailable && !isRefreshing && !isSubmitting;

  useEffect(() => { setConfirmation(null); }, [source]);

  async function confirmProduction() {
    if (!confirmation || submissionLocked.current || isRefreshing || !preview?.ok || !productsAvailable ||
      quantity !== confirmation.quantity) return;
    submissionLocked.current = true;
    setIsSubmitting(true);
    try {
      const result = await submit({ pcbCardId: source.cardId,
        plannedQuantity: confirmation.quantity,
        creationRequestId: confirmation.creationRequestId });
      if (result.ok) {
        creationAttempt.current = null;
        onProduced({ workOrderId: result.value.workOrderId,
          workOrderNumber: result.value.workOrderNumber, cardName: source.cardName,
          plannedQuantity: confirmation.quantity, projectName: null });
      } else {
        setErrorMessage(result.error.message);
        if (result.error.code !== "unknown_outcome") creationAttempt.current = null;
      }
    } catch {
      setErrorMessage("Work Order creation could not be confirmed. Retry to safely check the same request.");
    } finally {
      setConfirmation(null);
      setIsSubmitting(false);
      submissionLocked.current = false;
    }
  }

  function openConfirmation() {
    if (!canConfirm || !preview?.ok || !productsAvailable) return;
    setErrorMessage(null);
    if (creationAttempt.current?.quantity !== quantity) {
      creationAttempt.current = { quantity, requestId: crypto.randomUUID() };
    }
    setConfirmation({ quantity,
      creationRequestId: creationAttempt.current.requestId });
  }

  return <div className="space-y-6">
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="max-w-xl">
        <label className="block text-sm font-semibold text-zinc-800">Planned Production Quantity
          <input type="text" inputMode="numeric" value={quantity} disabled={isSubmitting || Boolean(confirmation)}
            onChange={(event) => { setQuantity(event.target.value); setErrorMessage(null); }}
            className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2" aria-describedby="quantity-help" />
        </label>
      </div>
      <p id="quantity-help" className="mt-3 text-sm text-zinc-500">
        Enter a positive whole number to freeze the production plan. Inventory is rechecked only when the Work Order is finished.
      </p>
      {errorMessage && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {errorMessage}
      </p>}
    </section>

    {!source.outputIsActive && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      The PCB output Product is archived and unavailable for production.
    </p>}
    {source.inputs.length === 0 && <p className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
      This active BOM has no input Products. The production Work Order will contain no material rows.
    </p>}
    {!preview && source.inputs.length > 0 && <EmptyState title="Enter planned quantity" description="Frozen BOM requirements will appear after you enter the planned quantity." />}
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
        Current Inventory is insufficient for this plan. You may create the Work Order, but it cannot be finished until stock is sufficient.
      </p>}
      {preview.ready && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Current physical stock meets the planned requirements. Finish will check it again authoritatively.
      </p>}
    </section>}
    <button type="button" onClick={openConfirmation} disabled={!canConfirm}
      className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
      Create Production Work Order
    </button>
    <ConfirmDialog open={Boolean(confirmation)}
      title={`Create production Work Order for ${source.cardName}?`}
      description={`This creates a Draft Work Order for ${confirmation?.quantity ?? ""} planned cards and freezes the current BOM materials. Inventory will not change until the Work Order is finished. The finished output will be stored in Finished Goods.`}
      confirmLabel="Create Work Order" onConfirm={() => void confirmProduction()}
      onCancel={() => { if (!isSubmitting) setConfirmation(null); }} isSubmitting={isSubmitting} />
  </div>;
}
