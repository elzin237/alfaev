import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import {
  addCalendarMonths,
  buildMonthGrid,
  formatAccessibleDate,
  formatMonthHeading,
  monthFromDateOnly,
  parseCalendarMonth,
  todayDateOnly,
  type CalendarMonth,
} from "./calendarDate";
import {
  buildCalendarEventsForYear,
  calendarEventsOnDate,
} from "./calendarProjection";
import {
  calendarCategories,
  calendarCategoryFilterLabels,
  type CalendarCategory,
} from "./calendarTypes";
import { useCalendarData } from "./useCalendarData";

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const categoryStyles: Record<CalendarCategory, string> = {
  birthday: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900",
  business_trip: "border-blue-200 bg-blue-50 text-blue-900",
  event: "border-amber-200 bg-amber-50 text-amber-900",
  vacation: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

interface CalendarPageProps {
  initialMonth?: string;
  today?: string;
}

function initialCalendarMonth(initialMonth: string | undefined, today: string) {
  if (initialMonth) {
    const parsed = parseCalendarMonth(initialMonth);
    if (parsed) return parsed;
  }

  return monthFromDateOnly(today);
}

function categoryMarker(category: CalendarCategory): string {
  switch (category) {
    case "birthday": return "B";
    case "business_trip": return "BT";
    case "event": return "E";
    case "vacation": return "V";
  }
}

function CalendarPage({ initialMonth, today: todayOverride }: CalendarPageProps) {
  const today = todayOverride ?? todayDateOnly();
  const [displayedMonth, setDisplayedMonth] = useState<CalendarMonth>(() =>
    initialCalendarMonth(initialMonth, today)
  );
  const [selectedCategories, setSelectedCategories] = useState<Set<CalendarCategory>>(
    () => new Set(calendarCategories),
  );
  const { entriesQuery, birthdaysQuery } = useCalendarData();
  const isLoading = entriesQuery.isPending || birthdaysQuery.isPending;
  const entriesResult = entriesQuery.data;
  const birthdaysResult = birthdaysQuery.data;
  const hasError = entriesQuery.isError || birthdaysQuery.isError ||
    (entriesResult !== undefined && !entriesResult.ok) ||
    (birthdaysResult !== undefined && !birthdaysResult.ok);
  const gridDays = useMemo(() => buildMonthGrid(displayedMonth), [displayedMonth]);
  const allEvents = useMemo(() => {
    if (!entriesResult?.ok || !birthdaysResult?.ok) return [];
    return buildCalendarEventsForYear(
      entriesResult.value,
      birthdaysResult.value,
      displayedMonth.year,
    );
  }, [birthdaysResult, displayedMonth.year, entriesResult]);
  const monthPrefix = `${String(displayedMonth.year).padStart(4, "0")}-${
    String(displayedMonth.month).padStart(2, "0")
  }`;
  const visibleMonthEventCount = gridDays
    .filter((day) => day.isCurrentMonth)
    .reduce((count, day) =>
      count + calendarEventsOnDate(allEvents, day.date, selectedCategories).length,
    0);

  const toggleCategory = (category: CalendarCategory) => {
    setSelectedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const retry = () => {
    void entriesQuery.refetch();
    void birthdaysQuery.refetch();
  };

  let content;
  if (isLoading) {
    content = <LoadingState message="Loading Calendar..." />;
  } else if (hasError || !entriesResult?.ok || !birthdaysResult?.ok) {
    content = (
      <ErrorState
        title="Unable to load Calendar"
        message="The complete Calendar could not be loaded. Please try again."
        onRetry={retry}
      />
    );
  } else {
    const heading = formatMonthHeading(displayedMonth);
    const noCategories = selectedCategories.size === 0;

    content = (
      <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 border-b border-zinc-200 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setDisplayedMonth((month) => addCalendarMonths(month, -1))}
              className="rounded-xl border border-zinc-300 p-2 text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => setDisplayedMonth(monthFromDateOnly(today))}
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setDisplayedMonth((month) => addCalendarMonths(month, 1))}
              className="rounded-xl border border-zinc-300 p-2 text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <h2 className="text-2xl font-bold text-zinc-900" aria-live="polite">
            {heading}
          </h2>

          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Calendar categories</legend>
            {calendarCategories.map((category) => (
              <label
                key={category}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                  selectedCategories.has(category)
                    ? categoryStyles[category]
                    : "border-zinc-200 bg-white text-zinc-500"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedCategories.has(category)}
                  onChange={() => toggleCategory(category)}
                  className="h-4 w-4 accent-red-600"
                />
                {calendarCategoryFilterLabels[category]}
              </label>
            ))}
          </fieldset>
        </div>

        {noCategories ? (
          <div className="border-b border-zinc-200 px-5 py-4">
            <EmptyState
              title="No categories selected"
              description="Select one or more categories to show Calendar items."
            />
          </div>
        ) : visibleMonthEventCount === 0 ? (
          <p className="border-b border-zinc-200 px-5 py-4 text-sm text-zinc-600" role="status">
            No events in {heading}.
          </p>
        ) : null}

        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
          {weekdayLabels.map((weekday) => (
            <div
              key={weekday}
              className="px-2 py-3 text-center text-xs font-bold uppercase tracking-wide text-zinc-500"
            >
              {weekday}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7" data-calendar-grid data-month={monthPrefix}>
          {gridDays.map((day) => {
            const dayEvents = calendarEventsOnDate(
              allEvents,
              day.date,
              selectedCategories,
            );
            const isToday = day.date === today;

            return (
              <article
                key={day.date}
                data-calendar-date={day.date}
                data-outside-month={!day.isCurrentMonth ? "true" : "false"}
                aria-label={`${formatAccessibleDate(day.date)}${isToday ? ", today" : ""}`}
                aria-current={isToday ? "date" : undefined}
                className={`min-h-28 border-b border-r border-zinc-200 p-2 sm:min-h-32 ${
                  day.isCurrentMonth ? "bg-white" : "bg-zinc-50 text-zinc-400"
                } ${isToday ? "ring-2 ring-inset ring-red-500" : ""}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <time
                    dateTime={day.date}
                    className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold ${
                      isToday ? "bg-red-600 text-white" : "text-inherit"
                    }`}
                  >
                    {day.day}
                  </time>
                  {isToday && <span className="sr-only">Today</span>}
                </div>

                {dayEvents.length > 0 && (
                  <ul className="space-y-1" aria-label={`Items for ${day.date}`}>
                    {dayEvents.map((event) => (
                      <li
                        key={event.id}
                        className={`rounded-lg border px-2 py-1 text-xs font-medium leading-4 ${categoryStyles[event.category]}`}
                        title={event.description ?? event.label}
                      >
                        <span aria-hidden="true" className="mr-1 font-bold">
                          {categoryMarker(event.category)}
                        </span>
                        <span>{event.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Company birthdays, business trips, events, and vacations."
      />
      {content}
    </div>
  );
}

export default CalendarPage;
