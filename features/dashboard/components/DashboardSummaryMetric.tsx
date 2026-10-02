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
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-zinc-200/90 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(24,24,27,0.04),0_8px_24px_rgba(24,24,27,0.035)]">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-inset ring-red-100"
      >
        <Icon className="size-5" strokeWidth={1.8} />
      </span>
      <dl className="min-w-0">
        <dt className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
          {label}
        </dt>
        <dd className="mt-0.5 text-2xl font-bold leading-none tabular-nums text-zinc-950">
          {value}
        </dd>
      </dl>
    </div>
  );
}

export default DashboardSummaryMetric;
