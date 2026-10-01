import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import type { DashboardWorkOrdersSection } from "../services/dashboardService";

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
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4">
        <h2 id="dashboard-work-orders-title" className="text-lg font-bold text-zinc-900">
          Recent Work Orders
        </h2>
        <Link
          to="/work-orders"
          className="rounded-lg text-sm font-semibold text-red-600 underline-offset-4 transition hover:text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
        >
          View all work orders
        </Link>
      </div>

      <div className="px-5 py-4">
        {section.recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No Work Orders yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {section.recent.map((workOrder) => {
              const isFinished = workOrder.status === "finished";
              const relevantDate = isFinished ? workOrder.finishedAt : workOrder.updatedAt;
              return (
                <li
                  key={workOrder.id}
                  className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/work-orders/${workOrder.id}`}
                      className="font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
                    >
                      {workOrder.workOrderNumber}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-zinc-500">
                      {workOrder.customerNameSnapshot ?? "Not set"}
                    </p>
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
