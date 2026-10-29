import { Activity, History } from "lucide-react";

import type { DashboardActivitySection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardEmptyState from "./DashboardEmptyState";

export interface DashboardActivityProps {
  section: DashboardActivitySection | null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function DashboardActivity({ section }: DashboardActivityProps) {
  if (section === null) return null;

  return (
    <section
      aria-labelledby="dashboard-activity-title"
      className="h-full min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View all activity"
        actionTo="/archive"
        icon={Activity}
        title="Recent Activity"
        titleId="dashboard-activity-title"
      />

      <div className="px-4 pb-3">
        {section.recent.length === 0 ? (
          <DashboardEmptyState icon={Activity} title="No recent activity." description="Activity available to your account will appear here as your team works." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.recent.map((activity) => (
              <li
                key={activity.auditLogId}
                className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 py-1.5"
              >
                <div className="flex min-w-0 flex-1 basis-48 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-500"
                  >
                    <History className="size-3.5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-xs font-medium leading-4 text-zinc-800">
                      {activity.summary}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                      By <span className="font-medium text-zinc-700">{activity.actorFullName}</span>
                    </p>
                  </div>
                </div>
                <time
                  dateTime={activity.createdAt}
                  className="text-[10px] text-zinc-500 sm:text-right"
                >
                  {dateTimeFormatter.format(new Date(activity.createdAt))}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DashboardActivity;
