import StatusBadge from "../../../shared/components/StatusBadge";
import { getProcurementStatusDisplay } from "../procurementStatus";
import type { ProcurementRequestListItem } from "../services/procurementService";

interface ProcurementListProps {
  requests: ProcurementRequestListItem[];
}

function ProcurementList({ requests }: ProcurementListProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {[
                "Serial Number / Šifra",
                "Name",
                "Supplier",
                "Requested Quantity",
                "Delivered",
                "Remaining",
                "Status",
                "Created By",
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
                  <td className="px-5 py-4">{request.supplierName}</td>
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
