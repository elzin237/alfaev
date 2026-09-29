import WorkOrderMaterialRow, {
  type DraftWorkOrderMaterial,
} from "./WorkOrderMaterialRow";

interface WorkOrderMaterialsTableProps {
  focusRequest: {
    productId: string;
    requestId: number;
  } | null;
  materials: DraftWorkOrderMaterial[];
  onQuantityChange: (productId: string, quantity: string) => void;
  onRemove: (productId: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  showRequiredErrors?: boolean;
}

function WorkOrderMaterialsTable({
  focusRequest,
  materials,
  onQuantityChange,
  onRemove,
  readOnly = false,
  disabled = false,
  showRequiredErrors = false,
}: WorkOrderMaterialsTableProps) {
  if (materials.length === 0) {
    return (
      <p className="mt-6 text-sm text-zinc-500">No materials added yet.</p>
    );
  }

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200">
      <table className="min-w-full divide-y divide-zinc-200">
        <thead className="bg-zinc-50">
          <tr>
            {[
              "Serial Number",
              "Product Name",
              "Quantity",
              "Current Inventory",
              ...(readOnly ? [] : ["Remove"]),
            ].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 last:text-right"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {materials.map((material) => (
            <WorkOrderMaterialRow
              key={material.productId}
              focusRequestId={focusRequest?.productId === material.productId
                ? focusRequest.requestId
                : null}
              material={material}
              onQuantityChange={onQuantityChange}
              onRemove={onRemove}
              readOnly={readOnly}
              disabled={disabled}
              showRequiredError={showRequiredErrors}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default WorkOrderMaterialsTable;
