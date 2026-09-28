import type { ExactInventoryQuantity } from "../services/workOrderService";

export interface DraftWorkOrderMaterial {
  productId: string;
  serialNumber: string;
  productName: string;
  quantity: string;
  currentInventory: ExactInventoryQuantity;
}

interface WorkOrderMaterialRowProps {
  index: number;
  material: DraftWorkOrderMaterial;
  onQuantityChange: (index: number, quantity: string) => void;
  onRemove: (index: number) => void;
}

const postgresBigintMax = 9223372036854775807n;

function quantityError(quantity: string): string | null {
  if (quantity === "") return null;
  if (!/^[1-9][0-9]*$/.test(quantity)) {
    return "Quantity must be a positive whole number.";
  }
  if (quantity.length > 19 || BigInt(quantity) > postgresBigintMax) {
    return "Quantity is above the supported whole-number range.";
  }
  return null;
}

function WorkOrderMaterialRow({
  index,
  material,
  onQuantityChange,
  onRemove,
}: WorkOrderMaterialRowProps) {
  const error = quantityError(material.quantity);
  const inputId = `work-order-material-quantity-${index}`;
  const errorId = `${inputId}-error`;

  return (
    <tr className="border-t border-zinc-200 align-top">
      <td className="whitespace-nowrap px-4 py-4 font-mono text-sm text-zinc-900">
        {material.serialNumber}
      </td>
      <td className="px-4 py-4 text-sm font-medium text-zinc-900">
        {material.productName}
      </td>
      <td className="min-w-48 px-4 py-4">
        <label htmlFor={inputId} className="sr-only">
          Quantity for {material.productName} ({material.serialNumber})
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={material.quantity}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          onChange={(event) => onQuantityChange(index, event.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
        />
        {error && (
          <p id={errorId} role="alert" className="mt-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-sm tabular-nums text-zinc-900">
        {material.currentInventory}
      </td>
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label={`Remove ${material.productName} (${material.serialNumber})`}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

export default WorkOrderMaterialRow;
