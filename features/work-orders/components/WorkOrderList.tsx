import StatusBadge from "../../../shared/components/StatusBadge";
import type { WorkOrderListItem } from "../services/workOrderService";

export interface WorkOrderListProps {
  workOrders: readonly WorkOrderListItem[];
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function WorkOrderList({ workOrders }: WorkOrderListProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {[
                "Work Order Number",
                "Project",
                "Customer",
                "Status",
                "Created Date",
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
            {workOrders.map((workOrder) => (
              <tr key={workOrder.id} className="text-sm text-zinc-700">
                <th
                  scope="row"
                  className="whitespace-nowrap px-5 py-4 text-left font-semibold text-zinc-900"
                >
                  {workOrder.workOrderNumber}
                </th>
                <td className="px-5 py-4">
                  {workOrder.projectName ?? "Not selected"}
                </td>
                <td className="px-5 py-4">
                  {workOrder.customerName ?? "Not set"}
                </td>
                <td className="whitespace-nowrap px-5 py-4">
                  <StatusBadge
                    label={workOrder.status === "draft" ? "Draft" : "Finished"}
                    tone={workOrder.status === "draft" ? "neutral" : "success"}
                  />
                </td>
                <td className="whitespace-nowrap px-5 py-4">
                  <time dateTime={workOrder.createdAt}>
                    {dateTimeFormatter.format(new Date(workOrder.createdAt))}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default WorkOrderList;
