import { CalendarDays } from "lucide-react";

import type {
  DashboardCalendarKind,
  DashboardCalendarSection,
} from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";
import DashboardEmptyState from "./DashboardEmptyState";

export interface DashboardCalendarProps {
  section: DashboardCalendarSection;
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

function DashboardCalendar({ section }: DashboardCalendarProps) {
  return (
    <section
      aria-labelledby="dashboard-calendar-title"
      className="h-full min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm"
    >
      <DashboardSectionHeader
        actionLabel="View full calendar"
        actionTo="/calendar"
        icon={CalendarDays}
        title="Upcoming Calendar"
        titleId="dashboard-calendar-title"
      />

      <div className="px-4 pb-3">
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
                  className="flex gap-3 py-2"
                >
                  <div
                    aria-hidden="true"
                    className="w-10 shrink-0 overflow-hidden rounded-md border border-zinc-100 bg-white text-center"
                  >
                    <div className="bg-red-50 px-1 py-0.5 text-[0.6rem] font-bold tracking-[0.12em] text-red-600">
                      {dateBlock.month}
                    </div>
                    <div className="py-1 text-base font-bold leading-none tabular-nums text-zinc-950">
                      {dateBlock.day}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-xs font-semibold leading-4 text-zinc-900">{item.title}</p>
                    <span className="mt-1 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-zinc-600">
                      {kindLabels[item.kind]}
                    </span>
                    <p className="mt-1.5 text-xs font-medium text-zinc-600">
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
