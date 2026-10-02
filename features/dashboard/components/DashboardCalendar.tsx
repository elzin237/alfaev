import { CalendarDays } from "lucide-react";

import type {
  DashboardCalendarKind,
  DashboardCalendarSection,
} from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";

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
      className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_12px_30px_rgba(24,24,27,0.04)]"
    >
      <DashboardSectionHeader
        actionLabel="View full calendar"
        actionTo="/calendar"
        icon={CalendarDays}
        title="Upcoming Calendar"
        titleId="dashboard-calendar-title"
      />

      <div className="px-5 py-4">
        {section.upcoming.length === 0 ? (
          <p className="text-sm text-zinc-500">No upcoming calendar entries.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.upcoming.map((item) => {
              const isSingleDay = item.startDate === item.endDate;
              const dateBlock = dateBlockParts(item.startDate);
              return (
                <li
                  key={`${item.kind}:${item.id}:${item.startDate}`}
                  className="flex gap-3 py-3.5"
                >
                  <div
                    aria-hidden="true"
                    className="w-12 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white text-center shadow-sm"
                  >
                    <div className="bg-red-600 px-1 py-1 text-[0.6rem] font-bold tracking-[0.12em] text-white">
                      {dateBlock.month}
                    </div>
                    <div className="py-1.5 text-lg font-bold leading-none tabular-nums text-zinc-950">
                      {dateBlock.day}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-900">{item.title}</p>
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
