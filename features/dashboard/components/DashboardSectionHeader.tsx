import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";

interface DashboardSectionHeaderProps {
  actionLabel: string;
  actionTo: string;
  icon: LucideIcon;
  title: string;
  titleId: string;
}

function DashboardSectionHeader({
  actionLabel,
  actionTo,
  icon: Icon,
  title,
  titleId,
}: DashboardSectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${title === "Projects Overview" || title === "Procurement Requests" ? "bg-blue-50 text-blue-600" : title === "Warehouse Stock Overview" || title === "Warehouse Stock Health" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}
        >
          <Icon className="size-[1.125rem]" strokeWidth={1.8} />
        </span>
        <h2 id={titleId} className="break-words text-sm font-semibold tracking-tight text-zinc-950">
          {title}
        </h2>
      </div>
      <Link
        to={actionTo}
        className="rounded-md text-xs font-semibold leading-5 text-red-700 underline-offset-4 transition hover:text-red-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

export default DashboardSectionHeader;
