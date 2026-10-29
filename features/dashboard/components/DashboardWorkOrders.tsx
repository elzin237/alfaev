import { ClipboardList } from "lucide-react";
import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import type { DashboardWorkOrdersSection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardEmptyState from "./DashboardEmptyState";

export interface DashboardWorkOrdersProps {
  section: DashboardWorkOrdersSection | null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function DashboardWorkOrders({ section }: DashboardWorkOrdersProps) {
  if (section === null) return null;

  return (
    <section
      aria-labelledby="dashboard-work-orders-title"
      className="h-full min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View all work orders"
        actionTo="/work-orders"
        icon={ClipboardList}
        title="Recent Work Orders"
        titleId="dashboard-work-orders-title"
      />

      <div className="px-4 pb-3">
        {section.recent.length === 0 ? (
          <DashboardEmptyState icon={ClipboardList} title="No Work Orders yet." description="Your most recently updated Work Orders will appear here as work gets underway." />
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-80 text-left text-xs">
            <thead className="bg-slate-50 text-[10px] text-zinc-500"><tr>{["Work Order", "Customer", "Status", "Last activity"].map(label => <th key={label} scope="col" className="px-2 py-2 font-semibold">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100">
            {section.recent.map((workOrder) => {
              const isFinished = workOrder.status === "finished";
              const relevantDate = isFinished ? workOrder.finishedAt : workOrder.updatedAt;
              return (
                <tr
                  key={workOrder.id}
                  className="align-top"
                >
                  <td className="px-2 py-2.5">
                      <Link
                        to={`/work-orders/${workOrder.id}`}
                        className="break-words rounded-sm font-semibold text-zinc-950 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
                      >
                        {workOrder.workOrderNumber}
                      </Link>
                  </td>
                  <td className="max-w-32 break-words px-2 py-2.5 text-zinc-500">{workOrder.customerNameSnapshot ?? "Not set"}</td>
                  <td className="px-2 py-2.5">
                  <StatusBadge
                    label={isFinished ? "Finished" : "Draft"}
                    tone={isFinished ? "success" : "neutral"}
                  />
                  </td>
                  <td className="px-2 py-2.5 text-[10px] text-zinc-500">{relevantDate && <><span className="block">{isFinished ? "Finished" : "Updated"}</span><time dateTime={relevantDate}>{dateTimeFormatter.format(new Date(relevantDate))}</time></>}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
      </div>
    </section>
  );
}

export default DashboardWorkOrders;
