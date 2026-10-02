import { ClipboardList, FileText } from "lucide-react";
import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import type { DashboardWorkOrdersSection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";

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
      className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_12px_30px_rgba(24,24,27,0.04)]"
    >
      <DashboardSectionHeader
        actionLabel="View all work orders"
        actionTo="/work-orders"
        icon={ClipboardList}
        title="Recent Work Orders"
        titleId="dashboard-work-orders-title"
      />

      <div className="px-5 py-4">
        {section.recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No Work Orders yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.recent.map((workOrder) => {
              const isFinished = workOrder.status === "finished";
              const relevantDate = isFinished ? workOrder.finishedAt : workOrder.updatedAt;
              return (
                <li
                  key={workOrder.id}
                  className="grid gap-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500"
                    >
                      <FileText className="size-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <Link
                        to={`/work-orders/${workOrder.id}`}
                        className="rounded-sm font-semibold text-zinc-950 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
                      >
                        {workOrder.workOrderNumber}
                      </Link>
                      <p className="mt-0.5 truncate text-sm text-zinc-500">
                        {workOrder.customerNameSnapshot ?? "Not set"}
                      </p>
                    </div>
                  </div>
                  {relevantDate && (
                    <p className="text-xs text-zinc-500 sm:text-right">
                      <span className="block font-medium text-zinc-700">
                        {isFinished ? "Finished" : "Updated"}
                      </span>
                      <time dateTime={relevantDate}>
                        {dateTimeFormatter.format(new Date(relevantDate))}
                      </time>
                    </p>
                  )}
                  <StatusBadge
                    label={isFinished ? "Finished" : "Draft"}
                    tone={isFinished ? "success" : "neutral"}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DashboardWorkOrders;
