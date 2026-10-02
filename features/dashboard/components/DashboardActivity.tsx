import { Activity, History } from "lucide-react";

import type { DashboardActivitySection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";

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
      className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_12px_30px_rgba(24,24,27,0.04)]"
    >
      <DashboardSectionHeader
        actionLabel="View all activity"
        actionTo="/archive"
        icon={Activity}
        title="Recent Activity"
        titleId="dashboard-activity-title"
      />

      <div className="px-5 py-4">
        {section.recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No recent activity.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.recent.map((activity) => (
              <li
                key={activity.auditLogId}
                className="grid gap-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"
                  >
                    <History className="size-3.5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold leading-5 text-zinc-900">
                      {activity.summary}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      By <span className="font-medium text-zinc-700">{activity.actorFullName}</span>
                    </p>
                  </div>
                </div>
                <time
                  dateTime={activity.createdAt}
                  className="text-xs text-zinc-500 sm:text-right"
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
