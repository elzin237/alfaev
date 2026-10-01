import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import { getProcurementStatusDisplay } from "../../procurement/procurementStatus";
import type { DashboardProcurementSection } from "../services/dashboardService";

export interface DashboardProcurementProps {
  section: DashboardProcurementSection | null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function DashboardProcurement({ section }: DashboardProcurementProps) {
  if (section === null) return null;

  return (
    <section
      aria-labelledby="dashboard-procurement-title"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="dashboard-procurement-title" className="text-lg font-bold text-zinc-900">
            Nabavka
          </h2>
          <dl className="flex items-baseline gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
            <dt className="text-[0.68rem] font-bold uppercase tracking-wide text-zinc-500">
              Unresolved
            </dt>
            <dd className="text-lg font-bold tabular-nums text-zinc-950">
              {section.unresolvedCount}
            </dd>
          </dl>
        </div>
        <Link
          to="/procurement"
          className="rounded-lg text-sm font-semibold text-red-600 underline-offset-4 transition hover:text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
        >
          View all
        </Link>
      </div>

      <div className="px-5 py-4">
        {section.unresolved.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No unresolved procurement requests.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {section.unresolved.map((request) => {
              const status = getProcurementStatusDisplay(request.status);
              return (
                <li
                  key={request.id}
                  className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center lg:gap-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-900">
                      {request.requestedName}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Serial Number / Šifra:{" "}
                      <span className="font-mono font-medium text-zinc-700">
                        {request.productSerialNumber ?? "Not assigned"}
                      </span>
                    </p>
                  </div>

                  <dl className="grid grid-cols-3 gap-3 text-xs">
                    {[
                      ["Requested", request.requestedQuantity],
                      ["Delivered", request.deliveredQuantity],
                      ["Remaining", request.remainingQuantity],
                    ].map(([label, quantity]) => (
                      <div key={label}>
                        <dt className="text-zinc-500">{label}</dt>
                        <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900">
                          {quantity}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
                    <StatusBadge label={status.label} tone={status.tone} />
                    <p className="text-xs text-zinc-500">
                      Updated{" "}
                      <time dateTime={request.updatedAt}>
                        {dateTimeFormatter.format(new Date(request.updatedAt))}
                      </time>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DashboardProcurement;
