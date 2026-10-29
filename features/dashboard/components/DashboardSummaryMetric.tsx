import type { LucideIcon } from "lucide-react";

interface DashboardSummaryMetricProps {
  icon: LucideIcon;
  label: string;
  value: number;
}

function DashboardSummaryMetric({
  icon: Icon,
  label,
  value,
}: DashboardSummaryMetricProps) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-xl border border-zinc-200/70 bg-white px-4 py-4 shadow-sm">
      <span aria-hidden="true" className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${label === "Active Projects" ? "bg-emerald-50 text-emerald-600" : label === "Active Products" ? "bg-blue-50 text-blue-600" : label === "Unresolved Procurement" ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}>
        <Icon className="size-6" strokeWidth={1.8} />
      </span>
      <dl className="min-w-0">
        <dt className="break-words text-xs font-semibold leading-5 text-zinc-800">{label}</dt>
        <dd className="mt-0.5 break-all text-3xl font-bold leading-none tracking-tight tabular-nums text-zinc-950">{value}</dd>
      </dl>
    </div>
  );
}

export default DashboardSummaryMetric;
