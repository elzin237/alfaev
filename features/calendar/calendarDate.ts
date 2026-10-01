export interface DateOnlyParts {
  year: number;
  month: number;
  day: number;
}

export interface CalendarMonth {
  year: number;
  month: number;
}

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthPattern = /^(\d{4})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseDateOnly(value: string): DateOnlyParts | null {
  const match = dateOnlyPattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function formatDateOnly(parts: DateOnlyParts): string {
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function parseCalendarMonth(value: string): CalendarMonth | null {
  const match = monthPattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return { year, month };
}

export function addCalendarMonths(
  month: CalendarMonth,
  amount: number,
): CalendarMonth {
  const zeroBased = month.year * 12 + month.month - 1 + amount;
  return {
    year: Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  };
}

export function todayDateOnly(now = new Date()): string {
  return formatDateOnly({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}

export function monthFromDateOnly(value: string): CalendarMonth {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error("Invalid date-only value");
  return { year: parsed.year, month: parsed.month };
}

export function formatMonthHeading(month: CalendarMonth): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(month.year, month.month - 1, 1)));
}

export function formatAccessibleDate(value: string): string {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error("Invalid date-only value");

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

function addDays(value: string, amount: number): string {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error("Invalid date-only value");
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount));

  return formatDateOnly({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export interface CalendarGridDay {
  date: string;
  day: number;
  isCurrentMonth: boolean;
}

export function buildMonthGrid(month: CalendarMonth): CalendarGridDay[] {
  const firstDate = formatDateOnly({ ...month, day: 1 });
  const firstWeekday = new Date(
    Date.UTC(month.year, month.month - 1, 1),
  ).getUTCDay();
  const leadingDays = (firstWeekday + 6) % 7;
  const gridStart = addDays(firstDate, -leadingDays);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const parsed = parseDateOnly(date);
    if (!parsed) throw new Error("Calendar grid produced an invalid date");

    return {
      date,
      day: parsed.day,
      isCurrentMonth: parsed.year === month.year && parsed.month === month.month,
    };
  });
}

export function isDateInInclusiveRange(
  date: string,
  startDate: string,
  endDate: string,
): boolean {
  return date >= startDate && date <= endDate;
}

export function isValidOccurrenceDate(
  year: number,
  month: number,
  day: number,
): boolean {
  return parseDateOnly(formatDateOnly({ year, month, day })) !== null;
}
