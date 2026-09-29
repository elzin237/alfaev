import { useEffect, useRef } from "react";

import type { ExactInventoryQuantity } from "../services/workOrderService";
import { getWorkOrderMaterialQuantityError } from "../workOrderMaterialQuantity";

export interface DraftWorkOrderMaterial {
  productId: string;
  serialNumber: string;
  productName: string;
  quantity: string;
  currentInventory: ExactInventoryQuantity;
}

interface WorkOrderMaterialRowProps {
  focusRequestId: number | null;
  material: DraftWorkOrderMaterial;
  onQuantityChange: (productId: string, quantity: string) => void;
  onRemove: (productId: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  showRequiredError?: boolean;
}

function WorkOrderMaterialRow({
  focusRequestId,
  material,
  onQuantityChange,
  onRemove,
  readOnly = false,
  disabled = false,
  showRequiredError = false,
}: WorkOrderMaterialRowProps) {
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const error = getWorkOrderMaterialQuantityError(
    material.quantity,
    showRequiredError,
  );
  const inputId = `work-order-material-quantity-${material.productId}`;
  const errorId = `${inputId}-error`;

  useEffect(() => {
    if (focusRequestId !== null) quantityInputRef.current?.focus();
  }, [focusRequestId]);

  return (
    <tr className="border-t border-zinc-200 align-top">
      <td className="whitespace-nowrap px-4 py-4 font-mono text-sm text-zinc-900">
        {material.serialNumber}
      </td>
      <td className="px-4 py-4 text-sm font-medium text-zinc-900">
        {material.productName}
      </td>
      <td className="min-w-48 px-4 py-4">
        {readOnly ? (
          <span className="text-sm tabular-nums text-zinc-900">
            {material.quantity}
          </span>
        ) : (
          <>
            <label htmlFor={inputId} className="sr-only">
              Quantity for {material.productName} ({material.serialNumber})
            </label>
            <input
              ref={quantityInputRef}
              id={inputId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={material.quantity}
              disabled={disabled}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
              onChange={(event) => onQuantityChange(
                material.productId,
                event.target.value,
              )}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition disabled:cursor-not-allowed disabled:bg-zinc-100 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
            {error && (
              <p id={errorId} role="alert" className="mt-2 text-xs font-medium text-red-700">
                {error}
              </p>
            )}
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-sm tabular-nums text-zinc-900">
        {material.currentInventory}
      </td>
      {!readOnly && (
        <td className="px-4 py-4 text-right">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(material.productId)}
            aria-label={`Remove ${material.productName} (${material.serialNumber})`}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remove
          </button>
        </td>
      )}
    </tr>
  );
}

export default WorkOrderMaterialRow;
