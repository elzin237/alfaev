import {
  formatDateOnly,
  isDateInInclusiveRange,
  isValidOccurrenceDate,
  parseDateOnly,
} from "./calendarDate";
import {
  calendarCategoryLabels,
  type CalendarBirthday,
  type CalendarCategory,
  type CalendarDisplayEvent,
  type CalendarEntry,
} from "./calendarTypes";

export function buildCalendarEventsForYear(
  entries: readonly CalendarEntry[],
  birthdays: readonly CalendarBirthday[],
  displayedYear: number,
): CalendarDisplayEvent[] {
  const entryEvents = entries.map<CalendarDisplayEvent>((entry) => ({
    id: `entry:${entry.id}`,
    category: entry.entryType,
    title: entry.title,
    label: `${calendarCategoryLabels[entry.entryType]}: ${entry.title}`,
    startDate: entry.startDate,
    endDate: entry.endDate,
    description: entry.description,
  }));
  const birthdayEvents = birthdays.flatMap<CalendarDisplayEvent>((birthday) => {
    const parsed = parseDateOnly(birthday.birthday);
    if (
      !parsed ||
      !isValidOccurrenceDate(displayedYear, parsed.month, parsed.day)
    ) {
      return [];
    }

    const occurrenceDate = formatDateOnly({
      year: displayedYear,
      month: parsed.month,
      day: parsed.day,
    });

    return [{
      id: `birthday:${birthday.userId}:${occurrenceDate}`,
      category: "birthday",
      title: birthday.fullName,
      label: `Birthday: ${birthday.fullName}`,
      startDate: occurrenceDate,
      endDate: occurrenceDate,
      description: null,
    }];
  });

  return [...entryEvents, ...birthdayEvents];
}

export function calendarEventsOnDate(
  events: readonly CalendarDisplayEvent[],
  date: string,
  selectedCategories: ReadonlySet<CalendarCategory>,
): CalendarDisplayEvent[] {
  return events.filter((event) =>
    selectedCategories.has(event.category) &&
    isDateInInclusiveRange(date, event.startDate, event.endDate)
  );
}
