import { useId } from "react";

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
  const columnHelpId = useId();
  const headings = [
    ["Serial", "Product Serial Number."],
    ["Product", "Requested Product name."],
    ["Supplier", "Supplier assigned to this request."],
    ["Requested", "Requested Quantity for this Procurement request."],
    ["Delivered", "Quantity delivered so far."],
    ["Remaining", "Requested Quantity remaining to be delivered."],
    ["Status", "Procurement request status."],
    ["Created By", "User who created this Procurement request."],
    ...(onUpdateDelivery || onResolve || onCreateProduct
      ? [["Actions", "Available actions for this Procurement request."]]
      : []),
  ];
  const cellClass = "px-2 py-3 text-center align-middle";
  const numericClass = `${cellClass} w-20 min-w-20 whitespace-nowrap tabular-nums`;

  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div role="region" aria-label="Procurement requests table" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-red-500">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {headings.map(([heading, description], index) => (
                <th
                  key={heading}
                  scope="col"
                  aria-describedby={`${columnHelpId}-${index}`}
                  className="whitespace-nowrap px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500"
                >
                  <span title={description}>{heading}</span>
                  <span id={`${columnHelpId}-${index}`} aria-hidden="true" className="sr-only">{description}</span>
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
                    className={`${cellClass} w-20 min-w-20 whitespace-nowrap font-mono font-semibold text-zinc-900`}
                  >
                    {request.productSerialNumber ?? "Not assigned"}
                  </th>
                  <td className={`${cellClass} min-w-40 max-w-64 [overflow-wrap:anywhere] font-semibold text-zinc-900`}>
                    {request.requestedName}
                  </td>
                  <td className={`${cellClass} min-w-36 max-w-56 [overflow-wrap:anywhere]`}>
                    {request.supplierName ?? "Not assigned"}
                  </td>
                  <td className={numericClass}>
                    {request.requestedQuantity}
                  </td>
                  <td className={numericClass}>
                    {request.deliveredQuantity}
                  </td>
                  <td className={numericClass}>
                    {request.remainingQuantity}
                  </td>
                  <td className={`${cellClass} whitespace-nowrap`}>
                    <StatusBadge label={status.label} tone={status.tone} />
                  </td>
                  <td className={`${cellClass} min-w-32 max-w-56 [overflow-wrap:anywhere]`}>{request.createdByFullName}</td>
                  {(onUpdateDelivery || onResolve || onCreateProduct) && (
                    <td className={`${cellClass} whitespace-nowrap`}>
                      {request.status === "resolved" ? null : (
                        <div className="flex w-max min-w-full flex-nowrap items-center justify-center gap-2 [&>button]:shrink-0">
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
