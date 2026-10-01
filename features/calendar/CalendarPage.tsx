import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import ConfirmDialog from "../../shared/components/ConfirmDialog";
import CalendarEntryDetailDialog from "./CalendarEntryDetailDialog";
import CalendarEntryFormDialog from "./CalendarEntryFormDialog";
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
  calendarCategoryLabels,
  type CalendarCategory,
  type CalendarDisplayEvent,
  type CalendarEntry,
  type CalendarEntryInput,
} from "./calendarTypes";
import { useCalendarData } from "./useCalendarData";
import { useCalendarManagement } from "./useCalendarManagement";

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
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CalendarEntry | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CalendarEntry | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const removingRef = useRef(false);
  const { entriesQuery, birthdaysQuery } = useCalendarData();
  const management = useCalendarManagement();
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
  const selectedEvent = selectedEventId
    ? allEvents.find((event) => event.id === selectedEventId) ?? null
    : null;
  const employeesResult = management.employeesQuery.data;
  const employees = employeesResult?.ok ? employeesResult.value : [];
  const employeesError = management.employeesQuery.isError ||
      (employeesResult !== undefined && !employeesResult.ok)
    ? "Related employees could not be loaded."
    : null;
  const selectedRelatedEmployeeName = selectedEvent?.relatedUserId
    ? employees.find((employee) => employee.userId === selectedEvent.relatedUserId)?.fullName ?? null
    : null;

  const entryForEvent = (event: CalendarDisplayEvent | null): CalendarEntry | null => {
    if (!event?.entryId || !entriesResult?.ok) return null;
    return entriesResult.value.find((entry) => entry.id === event.entryId) ?? null;
  };

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

  const openCreate = () => {
    setEditingEntry(null);
    setNotice(null);
    setFormOpen(true);
  };
  const openEdit = () => {
    const entry = entryForEvent(selectedEvent);
    if (!entry) return;
    setEditingEntry(entry);
    setSelectedEventId(null);
    setNotice(null);
    setFormOpen(true);
  };
  const openRemove = () => {
    const entry = entryForEvent(selectedEvent);
    if (!entry) return;
    setRemoveError(null);
    setRemoveTarget(entry);
    setSelectedEventId(null);
  };
  const saveEntry = (input: CalendarEntryInput) => editingEntry
    ? management.updateMutation.mutateAsync({ entry: editingEntry, input })
    : management.createMutation.mutateAsync(input);
  const removeEntry = async () => {
    if (!removeTarget || removingRef.current) return;
    removingRef.current = true;
    setRemoveError(null);
    try {
      const result = await management.deleteMutation.mutateAsync(removeTarget);
      if (!result.ok) {
        setRemoveError(result.error.message);
        return;
      }
      setRemoveTarget(null);
      setNotice("Calendar entry removed.");
    } finally {
      removingRef.current = false;
    }
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
                        className={`rounded-lg border text-xs font-medium leading-4 ${categoryStyles[event.category]}`}
                      >
                        <button type="button" onClick={() => setSelectedEventId(event.id)}
                          title={event.description ?? event.label}
                          className="w-full rounded-lg px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
                          <span aria-hidden="true" className="mr-1 font-bold">
                            {categoryMarker(event.category)}
                          </span>
                          <span>{event.label}</span>
                        </button>
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
        actions={management.canManage ? (
          <button type="button" onClick={openCreate}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
            Add Calendar Entry
          </button>
        ) : undefined}
      />
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
      {content}
      <CalendarEntryDetailDialog event={selectedEvent} canManage={management.canManage}
        relatedEmployeeName={selectedRelatedEmployeeName}
        onClose={() => setSelectedEventId(null)} onEdit={openEdit} onRemove={openRemove} />
      {management.canManage && <CalendarEntryFormDialog
        open={formOpen} entry={editingEntry} employees={employees}
        employeesLoading={management.employeesQuery.isPending}
        employeesError={employeesError}
        onClose={() => setFormOpen(false)} onSubmit={saveEntry}
        onSuccess={() => setNotice(editingEntry ? "Calendar entry updated." : "Calendar entry added.")} />}
      <ConfirmDialog open={removeTarget !== null} title="Remove Calendar Entry?"
        description={removeTarget
          ? `${removeTarget.title} (${calendarCategoryLabels[removeTarget.entryType]}, ${removeTarget.startDate}${removeTarget.endDate === removeTarget.startDate ? "" : ` – ${removeTarget.endDate}`}) will be permanently removed from Calendar.`
          : "This Calendar entry will be permanently removed."}
        confirmLabel="Remove" confirmVariant="danger" onConfirm={() => void removeEntry()}
        onCancel={() => { if (!management.deleteMutation.isPending) { setRemoveTarget(null); setRemoveError(null); } }}
        isSubmitting={management.deleteMutation.isPending} errorMessage={removeError} />
    </div>
  );
}

export default CalendarPage;
