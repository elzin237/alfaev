import { CalendarDays } from "lucide-react";

import type {
  DashboardCalendarKind,
  DashboardCalendarSection,
} from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardEmptyState from "./DashboardEmptyState";

export interface DashboardCalendarProps {
  section: DashboardCalendarSection;
  compact?: boolean;
}

const kindLabels: Record<DashboardCalendarKind, string> = {
  birthday: "Birthday",
  business_trip: "Business Trip",
  event: "Event",
  vacation: "Vacation",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function dateBlockParts(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return {
    day: String(date.getUTCDate()).padStart(2, "0"),
    month: monthFormatter.format(date).toUpperCase(),
  };
}

function DashboardCalendar({ section, compact = false }: DashboardCalendarProps) {
  return (
    <section
      aria-labelledby="dashboard-calendar-title"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View full calendar"
        actionTo="/calendar"
        icon={CalendarDays}
        title="Upcoming Calendar"
        description="Next scheduled events and important dates."
        titleId="dashboard-calendar-title"
        compact={compact}
      />

      <div role="region" aria-label="Upcoming Calendar content" tabIndex={0} className="min-h-0 flex-1 overflow-auto px-4 pb-3 focus-visible:outline-2 focus-visible:outline-red-500">
        {section.upcoming.length === 0 ? (
          <DashboardEmptyState icon={CalendarDays} title="No upcoming calendar entries." description="Company events, scheduled time away and upcoming birthdays will appear here." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.upcoming.map((item) => {
              const isSingleDay = item.startDate === item.endDate;
              const dateBlock = dateBlockParts(item.startDate);
              return (
                <li
                  key={`${item.kind}:${item.id}:${item.startDate}`}
                  className={compact ? "flex gap-2 py-1" : "flex gap-3 py-2"}
                >
                  <div
                    aria-hidden="true"
                    className={`${compact ? "w-8" : "w-10"} shrink-0 overflow-hidden rounded-md border border-zinc-100 bg-white text-center`}
                  >
                    <div className={`bg-red-50 px-1 ${compact ? "text-[8px] leading-3" : "py-0.5 text-[0.6rem]"} font-bold tracking-[0.12em] text-red-600`}>
                      {dateBlock.month}
                    </div>
                    <div className={`${compact ? "py-0.5 text-sm" : "py-1 text-base"} font-bold leading-none tabular-nums text-zinc-950`}>
                      {dateBlock.day}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className={compact ? "min-w-0 leading-3" : "min-w-0"}>
                    <p title={item.title} className="line-clamp-1 break-words text-xs font-semibold leading-4 text-zinc-900">{item.title}</p>
                    <span className={`${compact ? "text-[9px] leading-3" : "mt-1 px-2 py-0.5 text-[0.65rem]"} inline-flex rounded-md border border-zinc-200 bg-zinc-50 font-bold uppercase tracking-wide text-zinc-600`}>
                      {kindLabels[item.kind]}
                    </span>
                    </div>
                    <p className="text-[11px] font-medium text-zinc-500">
                      {isSingleDay ? (
                        <time dateTime={item.startDate}>{formatDate(item.startDate)}</time>
                      ) : (
                        <>
                          <time dateTime={item.startDate}>{formatDate(item.startDate)}</time>
                          <span aria-hidden="true"> – </span>
                          <time dateTime={item.endDate}>{formatDate(item.endDate)}</time>
                        </>
                      )}
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

export default DashboardCalendar;
