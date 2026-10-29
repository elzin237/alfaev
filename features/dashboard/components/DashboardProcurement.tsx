import { ShoppingCart } from "lucide-react";

import StatusBadge from "../../../shared/components/StatusBadge";
import { getProcurementStatusDisplay } from "../../procurement/procurementStatus";
import type { DashboardProcurementSection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";

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
      className="h-full min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View all"
        actionTo="/procurement"
        icon={ShoppingCart}
        title="Procurement Requests"
        titleId="dashboard-procurement-title"
      />

      <div className="px-4 pb-3">
        <div className="mb-3 rounded-lg bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>Requests over time</span><span className="flex gap-3"><span className="flex items-center gap-1"><i aria-hidden="true" className="size-2 rounded-full bg-blue-500" />Created</span><span className="flex items-center gap-1"><i aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />Resolved</span></span>
          </div>
          <p className="py-5 text-center text-xs leading-5 text-zinc-500">Time-series data unavailable.<br />A trusted lifecycle aggregate is required.</p>
        </div>
        <p className="mb-2 text-[11px] font-semibold text-zinc-500">Unresolved requests · Recently updated</p>
        {section.unresolved.length === 0 ? (
          <p className="py-3 text-xs text-zinc-500">No unresolved procurement requests.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.unresolved.map((request) => {
              const status = getProcurementStatusDisplay(request.status);
              return (
                <li
                  key={request.id}
                  className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="break-words font-semibold text-zinc-900">
                      {request.requestedName}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Serial Number:{" "}
                      <span className="font-mono font-medium text-zinc-700">
                        {request.productSerialNumber ?? "Not assigned"}
                      </span>
                    </p>
                  </div>

                  <dl className="grid w-full min-w-0 grid-cols-3 gap-3 text-xs">
                    {[
                      ["Requested", request.requestedQuantity],
                      ["Delivered", request.deliveredQuantity],
                      ["Remaining", request.remainingQuantity],
                    ].map(([label, quantity]) => (
                      <div key={label}>
                        <dt className="text-zinc-500">{label}</dt>
                        <dd className="mt-0.5 break-all font-semibold tabular-nums text-zinc-900">
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
