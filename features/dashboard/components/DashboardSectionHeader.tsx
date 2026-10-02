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
    <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-inset ring-red-100"
        >
          <Icon className="size-[1.125rem]" strokeWidth={1.8} />
        </span>
        <h2 id={titleId} className="truncate text-base font-bold text-zinc-950">
          {title}
        </h2>
      </div>
      <Link
        to={actionTo}
        className="shrink-0 rounded-md text-sm font-semibold text-red-600 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

export default DashboardSectionHeader;
