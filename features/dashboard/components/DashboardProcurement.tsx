import { CheckCircle2, ShoppingCart } from "lucide-react";

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
      className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_12px_30px_rgba(24,24,27,0.04)]"
    >
      <DashboardSectionHeader
        actionLabel="View all"
        actionTo="/procurement"
        icon={ShoppingCart}
        title="Nabavka"
        titleId="dashboard-procurement-title"
      />

      <div className="border-b border-zinc-100 bg-zinc-50/60 px-5 py-4">
        <dl className="flex items-center justify-between gap-4">
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">
              Unresolved
            </dt>
            <dd className="mt-1 text-3xl font-bold leading-none tabular-nums text-zinc-950">
              {section.unresolvedCount}
            </dd>
          </div>
          {section.unresolvedCount === 0 && (
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100"
            >
              <CheckCircle2 className="size-5" strokeWidth={1.8} />
            </span>
          )}
        </dl>
      </div>

      <div className="px-5 py-4">
        {section.unresolved.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No unresolved procurement requests.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.unresolved.map((request) => {
              const status = getProcurementStatusDisplay(request.status);
              return (
                <li
                  key={request.id}
                  className="grid gap-3 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center lg:gap-4"
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
