import WorkOrderMaterialRow, {
  type DraftWorkOrderMaterial,
} from "./WorkOrderMaterialRow";
import type { WorkOrderMaterialSourceType } from "../services/workOrderService";

interface WorkOrderMaterialsTableProps {
  focusRequest: {
    productId: string;
    requestId: number;
  } | null;
  materials: DraftWorkOrderMaterial[];
  onQuantityChange: (
    productId: string,
    sourceType: WorkOrderMaterialSourceType,
    quantity: string,
  ) => void;
  onRemove: (productId: string, sourceType: WorkOrderMaterialSourceType) => void;
  showSource?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  showRequiredErrors?: boolean;
  emptyDescription?: string;
}

function WorkOrderMaterialsTable({
  focusRequest,
  materials,
  onQuantityChange,
  onRemove,
  showSource = false,
  readOnly = false,
  disabled = false,
  showRequiredErrors = false,
  emptyDescription = "No materials added yet.",
}: WorkOrderMaterialsTableProps) {
  if (materials.length === 0) {
    return (
      <p className="mt-6 text-sm text-zinc-500">{emptyDescription}</p>
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
              ...(showSource ? ["Source"] : []),
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
              key={`${material.sourceType}:${material.productId}`}
              focusRequestId={material.sourceType === "manual" &&
                  focusRequest?.productId === material.productId
                ? focusRequest.requestId
                : null}
              material={material}
              showSource={showSource}
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
