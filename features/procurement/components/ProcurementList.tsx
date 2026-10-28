import StatusBadge from "../../../shared/components/StatusBadge";
import { getProcurementStatusDisplay } from "../procurementStatus";
import type { ProcurementRequestListItem } from "../services/procurementService";

interface ProcurementListProps {
  requests: ProcurementRequestListItem[];
  onUpdateDelivery?: (request: ProcurementRequestListItem) => void;
  onResolve?: (request: ProcurementRequestListItem) => void;
  onCreateProduct?: (request: ProcurementRequestListItem) => void;
}

function ProcurementList({
  requests,
  onUpdateDelivery,
  onResolve,
  onCreateProduct,
}: ProcurementListProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {[
                "Serial Number",
                "Name",
                "Supplier",
                "Requested Quantity",
                "Delivered",
                "Remaining",
                "Status",
                "Created By",
                ...(onUpdateDelivery || onResolve || onCreateProduct
                  ? ["Actions"]
                  : []),
              ].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {requests.map((request) => {
              const status = getProcurementStatusDisplay(request.status);

              return (
                <tr key={request.requestId} className="text-sm text-zinc-700">
                  <th
                    scope="row"
                    className="whitespace-nowrap px-5 py-4 text-left font-mono font-semibold text-zinc-900"
                  >
                    {request.productSerialNumber ?? "Not assigned"}
                  </th>
                  <td className="px-5 py-4 font-semibold text-zinc-900">
                    {request.requestedName}
                  </td>
                  <td className="px-5 py-4">
                    {request.supplierName ?? "Not assigned"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                    {request.requestedQuantity}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                    {request.deliveredQuantity}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                    {request.remainingQuantity}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <StatusBadge label={status.label} tone={status.tone} />
                  </td>
                  <td className="px-5 py-4">{request.createdByFullName}</td>
                  {(onUpdateDelivery || onResolve || onCreateProduct) && (
                    <td className="whitespace-nowrap px-5 py-4">
                      {request.status === "resolved" ? null : (
                        <div className="flex items-center gap-2">
                          {onUpdateDelivery && (
                            <button
                              type="button"
                              onClick={() => onUpdateDelivery(request)}
                              className="rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                            >
                              Update Delivery
                            </button>
                          )}
                          {onResolve && (
                            <button
                              type="button"
                              onClick={() => onResolve(request)}
                              className="rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                            >
                              Resolve
                            </button>
                          )}
                          {onCreateProduct && request.productId === null && (
                            <button
                              type="button"
                              onClick={() => onCreateProduct(request)}
                              className="rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                            >
                              Create component from request
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProcurementList;
