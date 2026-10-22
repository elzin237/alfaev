import { useEffect, useRef, useState } from "react";

import type { InventoryWarehouse } from "../inventoryWarehouses";
import type {
  InventoryTransferInput,
  InventoryTransferResult,
} from "../services/inventoryBalanceService";

interface InventoryTransferDialogProps {
  open: boolean;
  sourceWarehouse: InventoryWarehouse;
  destinations: readonly InventoryWarehouse[];
  onClose: () => void;
  onSubmit: (input: InventoryTransferInput) => Promise<InventoryTransferResult>;
  onSucceeded: (result: Extract<InventoryTransferResult, { ok: true }>['value']) => void;
}

export default function InventoryTransferDialog({
  open,
  sourceWarehouse,
  destinations,
  onClose,
  onSubmit,
  onSucceeded,
}: InventoryTransferDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const firstControlRef = useRef<HTMLSelectElement>(null);
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDestinationWarehouseId(destinations[0]?.id ?? "");
    setQuantity("");
    setReason("");
    setError(null);
    queueMicrotask(() => firstControlRef.current?.focus());
  }, [destinations, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onClose, open]);

  if (!open) return null;
  const parsedQuantity = Number(quantity);
  const canSubmit = destinationWarehouseId.length > 0 &&
    Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0 &&
    reason.trim().length > 0 && !isSubmitting;

  async function submit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit({
        destinationWarehouseId,
        quantity: parsedQuantity,
        reason: reason.trim(),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onSucceeded(result.value);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-transfer-title"
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"
      >
        <h2 id="inventory-transfer-title" className="text-xl font-bold text-zinc-900">
          Transfer Inventory
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Move stock atomically from {sourceWarehouse.label}.
        </p>
        <div className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-zinc-700">
            Destination warehouse
            <select
              ref={firstControlRef}
              value={destinationWarehouseId}
              onChange={(event) => setDestinationWarehouseId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3"
            >
              {destinations.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-zinc-700">
            Quantity
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3"
            />
          </label>
          <label className="block text-sm font-semibold text-zinc-700">
            Reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 min-h-24 w-full rounded-xl border border-zinc-300 px-4 py-3"
            />
          </label>
          {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSubmitting ? "Transferring..." : "Transfer Inventory"}
          </button>
        </div>
      </section>
    </div>
  );
}
