import { Activity, History } from "lucide-react";

import type { DashboardActivitySection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardEmptyState from "./DashboardEmptyState";

export interface DashboardActivityProps {
  section: DashboardActivitySection | null;
  compact?: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function DashboardActivity({ section, compact = false }: DashboardActivityProps) {
  if (section === null) return null;

  return (
    <section
      aria-labelledby="dashboard-activity-title"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View all activity"
        actionTo="/archive"
        icon={Activity}
        title="Recent Activity"
        description="Latest updates across your operations."
        titleId="dashboard-activity-title"
        compact={compact}
      />

      <div role="region" aria-label="Recent Activity content" tabIndex={0} className="min-h-0 flex-1 overflow-auto px-4 pb-3 focus-visible:outline-2 focus-visible:outline-red-500">
        {section.recent.length === 0 ? (
          <DashboardEmptyState icon={Activity} title="No recent activity." description="Activity available to your account will appear here as your team works." />
        ) : (
          <ul className="ml-1 border-l border-zinc-200 pl-4">
            {section.recent.map((activity) => (
              <li
                key={activity.auditLogId}
                className={`relative flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 border-b border-zinc-100 ${compact ? "py-1.5" : "py-2"} last:border-0 before:absolute before:-left-[21px] before:top-4 before:size-2 before:rounded-full before:bg-red-400`}
              >
                <div className={`flex min-w-0 flex-1 ${compact ? "basis-full gap-2" : "basis-48 gap-3"} items-start`}>
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-500"
                  >
                    <History className="size-3.5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p title={activity.summary} className={`${compact ? "line-clamp-1" : "line-clamp-2"} break-words text-xs font-medium leading-4 text-zinc-800`}>
                      {activity.summary}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                      By <span className="font-medium text-zinc-700">{activity.actorFullName}</span>
                      {compact && <> · <time dateTime={activity.createdAt}>{dateTimeFormatter.format(new Date(activity.createdAt))}</time></>}
                    </p>
                  </div>
                </div>
                {!compact && <time
                  dateTime={activity.createdAt}
                  className="text-[10px] text-zinc-500 sm:text-right"
                >
                  {dateTimeFormatter.format(new Date(activity.createdAt))}
                </time>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DashboardActivity;
