import { ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

interface DashboardSectionHeaderProps {
  actionLabel: string;
  actionTo: string;
  icon: LucideIcon;
  title: string;
  titleId: string;
  description?: string;
  compact?: boolean;
}

function DashboardSectionHeader({
  actionLabel,
  actionTo,
  icon: Icon,
  title,
  titleId,
  description,
  compact = false,
}: DashboardSectionHeaderProps) {
  return (
    <div className={`flex shrink-0 items-center justify-between gap-2 px-4 ${compact ? "h-12" : "min-h-20 py-4"}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex ${compact ? "size-7" : "size-10"} shrink-0 items-center justify-center rounded-xl ${title === "Projects & Production" || title === "Procurement Requests" ? "bg-blue-50 text-blue-600" : title === "Warehouse Stock Overview" || title === "Warehouse Stock Health" || title === "Inventory Health" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}
        >
          <Icon className="size-[1.125rem]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0"><h2 id={titleId} title={title} className="line-clamp-1 text-sm font-bold tracking-tight text-zinc-950">
          {title}
        </h2>{description && !compact && <p title={description} className="mt-1 line-clamp-1 text-xs leading-4 text-zinc-500">{description}</p>}</div>
      </div>
      <Link
        to={actionTo}
        aria-label={actionLabel}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-[11px] font-semibold leading-5 text-red-700 underline-offset-4 transition hover:text-red-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
      >
        {actionLabel === "View all projects" || actionLabel === "View all work orders" ? "View all" : actionLabel === "View full calendar" ? "View calendar" : actionLabel}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

export default DashboardSectionHeader;
