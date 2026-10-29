import type { LucideIcon } from "lucide-react";

interface DashboardSummaryMetricProps {
  icon: LucideIcon;
  label: string;
  value: number;
  description?: string;
}

function DashboardSummaryMetric({
  icon: Icon,
  label,
  value,
  description,
}: DashboardSummaryMetricProps) {
  return (
    <div className="flex min-h-32 min-w-0 items-start gap-3 rounded-xl border border-zinc-200/70 bg-white p-4 shadow-sm @5xl:h-[140px] sm:py-5">
      <span aria-hidden="true" className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${label === "Active Projects" ? "bg-emerald-50 text-emerald-600" : label === "Active Products" ? "bg-blue-50 text-blue-600" : label === "Unresolved Procurement" ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}>
        <Icon className="size-6" strokeWidth={1.8} />
      </span>
      <dl className="min-w-0">
        <dt className="break-words text-xs font-semibold leading-5 text-zinc-800">{label}</dt>
        <dd className="mt-0.5 break-all text-3xl font-bold leading-none tracking-tight tabular-nums text-zinc-950">{value}</dd>
        {description && <dd className="mt-2 text-[11px] leading-4 text-zinc-500">{description}</dd>}
      </dl>
    </div>
  );
}

export default DashboardSummaryMetric;
