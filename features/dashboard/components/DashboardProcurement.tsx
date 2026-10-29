import { ShoppingCart } from "lucide-react";
import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import { getProcurementStatusDisplay } from "../../procurement/procurementStatus";
import type { DashboardProcurementSection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";

export interface DashboardProcurementProps {
  section: DashboardProcurementSection | null;
  compact?: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function DashboardProcurement({ section, compact = false }: DashboardProcurementProps) {
  if (section === null) return null;

  if (compact) return <section aria-labelledby="dashboard-procurement-title" className="flex min-h-0 flex-col">
    <DashboardSectionHeader actionLabel="View all" actionTo="/procurement" icon={ShoppingCart} title="Procurement Requests" titleId="dashboard-procurement-title" compact />
    <div role="region" aria-label="Procurement Requests content" tabIndex={0} className="min-h-0 flex-1 overflow-auto px-4 pb-3 focus-visible:outline-2 focus-visible:outline-red-500">
    {section.unresolved.length === 0 ? <p className="py-2 text-xs text-zinc-500">No unresolved procurement requests.</p> : <ul className="divide-y divide-zinc-100">{section.unresolved.map(request => {
      const status = getProcurementStatusDisplay(request.status);
      return <li key={request.id} className="py-1">
        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><Link title={request.requestedName} to="/procurement" className="line-clamp-1 break-words rounded text-xs font-semibold text-zinc-900 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-300">{request.requestedName}</Link><p className="mt-1 text-[11px] text-zinc-500">Procurement request · <span className="font-mono">{request.productSerialNumber ?? "Not assigned"}</span></p></div><span className="max-w-32 break-all rounded-md bg-red-50 px-2 py-1 text-right text-[11px] font-semibold text-red-600 tabular-nums">{request.remainingQuantity} remaining</span></div>
        <details className="mt-1 text-[11px] text-zinc-500"><summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-red-500">Request details</summary><dl className="mt-2 grid grid-cols-3 gap-2">{[["Requested",request.requestedQuantity],["Delivered",request.deliveredQuantity],["Remaining",request.remainingQuantity]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className="break-all font-semibold text-zinc-800 tabular-nums">{value}</dd></div>)}</dl><div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge label={status.label} tone={status.tone}/><time dateTime={request.updatedAt}>Updated {dateTimeFormatter.format(new Date(request.updatedAt))}</time></div></details>
      </li>;
    })}</ul>}
    <details className="mt-1 text-[11px] text-zinc-500"><summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-red-500">Procurement trends · unavailable</summary><p className="py-2">Time-series data unavailable. A trusted lifecycle aggregate is required.</p></details>
    </div>
  </section>;

  return (
    <section
      aria-labelledby="dashboard-procurement-title"
      className={compact ? "min-w-0 border-t border-zinc-100" : "h-full min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"}
    >
      <DashboardSectionHeader
        actionLabel="View all"
        actionTo="/procurement"
        icon={ShoppingCart}
        title="Procurement Requests"
        titleId="dashboard-procurement-title"
      />

      <div className="px-4 pb-3">
        {!compact && <div className="mb-3 rounded-lg bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>Requests over time</span><span className="flex gap-3"><span className="flex items-center gap-1"><i aria-hidden="true" className="size-2 rounded-full bg-blue-500" />Created</span><span className="flex items-center gap-1"><i aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />Resolved</span></span>
          </div>
          <p className="py-5 text-center text-xs leading-5 text-zinc-500">Time-series data unavailable.<br />A trusted lifecycle aggregate is required.</p>
        </div>}
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

                  <dl className="grid w-full min-w-0 grid-cols-3 gap-3 rounded-lg bg-zinc-50 p-2 text-xs">
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

                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
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
