import { supabase } from "../../lib/supabase/client";
import { parseDateOnly } from "./calendarDate";
import type {
  CalendarBirthday,
  CalendarEntry,
  CalendarEntryType,
} from "./calendarTypes";

interface CalendarEntryRow {
  id: string;
  entry_type: CalendarEntryType;
  title: string;
  start_date: string;
  end_date: string;
  description: string | null;
  related_user_id: string | null;
}

interface CalendarBirthdayRow {
  user_id: string;
  full_name: string;
  birthday: string;
}

interface CalendarReadError {
  code: "calendar_entries_failed" | "calendar_birthdays_failed";
  message: string;
}

export type CalendarEntriesResult =
  | { ok: true; value: CalendarEntry[] }
  | { ok: false; error: CalendarReadError };

export type CalendarBirthdaysResult =
  | { ok: true; value: CalendarBirthday[] }
  | { ok: false; error: CalendarReadError };

const calendarEntryFields =
  "id,entry_type,title,start_date,end_date,description,related_user_id";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entryTypes = new Set<CalendarEntryType>([
  "business_trip",
  "event",
  "vacation",
]);

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index]);
}

function isTrimmedNonblank(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isCalendarEntryRow(value: unknown): value is CalendarEntryRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;

  return hasExactKeys(row, [
    "description",
    "end_date",
    "entry_type",
    "id",
    "related_user_id",
    "start_date",
    "title",
  ]) &&
    isUuid(row.id) &&
    typeof row.entry_type === "string" &&
    entryTypes.has(row.entry_type as CalendarEntryType) &&
    isTrimmedNonblank(row.title) &&
    typeof row.start_date === "string" &&
    parseDateOnly(row.start_date) !== null &&
    typeof row.end_date === "string" &&
    parseDateOnly(row.end_date) !== null &&
    row.end_date >= row.start_date &&
    (row.description === null || isTrimmedNonblank(row.description)) &&
    (row.related_user_id === null || isUuid(row.related_user_id));
}

function isCalendarBirthdayRow(value: unknown): value is CalendarBirthdayRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;

  return hasExactKeys(row, ["birthday", "full_name", "user_id"]) &&
    isUuid(row.user_id) &&
    isTrimmedNonblank(row.full_name) &&
    typeof row.birthday === "string" &&
    parseDateOnly(row.birthday) !== null;
}

function entriesFailure(): CalendarEntriesResult {
  return {
    ok: false,
    error: {
      code: "calendar_entries_failed",
      message: "Calendar entries could not be loaded.",
    },
  };
}

function birthdaysFailure(): CalendarBirthdaysResult {
  return {
    ok: false,
    error: {
      code: "calendar_birthdays_failed",
      message: "Calendar birthdays could not be loaded.",
    },
  };
}

export async function listCalendarEntries(): Promise<CalendarEntriesResult> {
  try {
    const { data, error } = await supabase
      .from("calendar_entries")
      .select(calendarEntryFields);

    if (error || !Array.isArray(data) || !data.every(isCalendarEntryRow)) {
      return entriesFailure();
    }

    return {
      ok: true,
      value: data.map((row) => ({
        id: row.id,
        entryType: row.entry_type,
        title: row.title,
        startDate: row.start_date,
        endDate: row.end_date,
        description: row.description,
        relatedUserId: row.related_user_id,
      })),
    };
  } catch {
    return entriesFailure();
  }
}

export async function listCalendarBirthdays(): Promise<CalendarBirthdaysResult> {
  try {
    const { data, error } = await supabase.rpc("list_calendar_birthdays");

    if (error || !Array.isArray(data) || !data.every(isCalendarBirthdayRow)) {
      return birthdaysFailure();
    }

    return {
      ok: true,
      value: data.map((row) => ({
        userId: row.user_id,
        fullName: row.full_name,
        birthday: row.birthday,
      })),
    };
  } catch {
    return birthdaysFailure();
  }
}
