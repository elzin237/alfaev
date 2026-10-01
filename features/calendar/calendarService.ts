import { supabase } from "../../lib/supabase/client";
import { parseDateOnly } from "./calendarDate";
import type {
  CalendarBirthday,
  CalendarEmployeeChoice,
  CalendarEntry,
  CalendarEntryInput,
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
  updated_at: string;
}

interface CalendarBirthdayRow {
  user_id: string;
  full_name: string;
  birthday: string;
}

interface CalendarEmployeeChoiceRow {
  user_id: string;
  full_name: string;
}

interface CalendarMutationRow {
  calendar_entry_id: string;
  calendar_entry_updated_at: string;
}

interface CalendarReadError {
  code:
    | "calendar_entries_failed"
    | "calendar_birthdays_failed"
    | "calendar_employees_failed";
  message: string;
}

export type CalendarMutationErrorCode =
  | "access_denied"
  | "not_found"
  | "stale_entry"
  | "invalid_input"
  | "calendar_mutation_failed";

export interface CalendarMutationError {
  code: CalendarMutationErrorCode;
  message: string;
}

export interface CalendarMutationValue {
  id: string;
  updatedAt: string;
}

export type CalendarEntriesResult =
  | { ok: true; value: CalendarEntry[] }
  | { ok: false; error: CalendarReadError };

export type CalendarBirthdaysResult =
  | { ok: true; value: CalendarBirthday[] }
  | { ok: false; error: CalendarReadError };

export type CalendarEmployeesResult =
  | { ok: true; value: CalendarEmployeeChoice[] }
  | { ok: false; error: CalendarReadError };

export type CalendarMutationResult =
  | { ok: true; value: CalendarMutationValue }
  | { ok: false; error: CalendarMutationError };

const calendarEntryFields =
  "id,entry_type,title,start_date,end_date,description,related_user_id,updated_at";
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

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    parseDateOnly(value.slice(0, 10)) !== null &&
    !Number.isNaN(Date.parse(value));
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
    "updated_at",
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
    (row.related_user_id === null || isUuid(row.related_user_id)) &&
    isTimestamp(row.updated_at);
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

function employeesFailure(): CalendarEmployeesResult {
  return {
    ok: false,
    error: {
      code: "calendar_employees_failed",
      message: "Related employees could not be loaded.",
    },
  };
}

function mutationFailure(code?: string): CalendarMutationResult {
  const error: CalendarMutationError = code === "42501"
    ? { code: "access_denied", message: "You do not have permission to manage Calendar entries." }
    : code === "P0002"
    ? { code: "not_found", message: "This Calendar entry or related employee no longer exists." }
    : code === "CAL01"
    ? { code: "stale_entry", message: "This Calendar entry changed. Review the latest version and try again." }
    : code === "22023" || code === "22007"
    ? { code: "invalid_input", message: "Check the Calendar entry fields and try again." }
    : { code: "calendar_mutation_failed", message: "The Calendar entry could not be saved. Please try again." };

  return { ok: false, error };
}

function isCalendarEmployeeChoiceRow(value: unknown): value is CalendarEmployeeChoiceRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return hasExactKeys(row, ["full_name", "user_id"]) &&
    isUuid(row.user_id) && isTrimmedNonblank(row.full_name);
}

function isCalendarMutationRow(value: unknown): value is CalendarMutationRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return hasExactKeys(row, ["calendar_entry_id", "calendar_entry_updated_at"]) &&
    isUuid(row.calendar_entry_id) && isTimestamp(row.calendar_entry_updated_at);
}

function normalizeCalendarEntryInput(input: CalendarEntryInput): CalendarEntryInput | null {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  if (!entryTypes.has(input.entryType) || title.length === 0 ||
    parseDateOnly(input.startDate) === null || parseDateOnly(input.endDate) === null ||
    input.endDate < input.startDate ||
    (input.relatedUserId !== null && !isUuid(input.relatedUserId))) {
    return null;
  }
  return { ...input, title, description };
}

function mapMutationData(
  data: unknown,
  providerFailed: boolean,
  errorCode?: string,
): CalendarMutationResult {
  if (providerFailed || !Array.isArray(data) || data.length !== 1 || !isCalendarMutationRow(data[0])) {
    return mutationFailure(errorCode);
  }
  return {
    ok: true,
    value: {
      id: data[0].calendar_entry_id,
      updatedAt: data[0].calendar_entry_updated_at,
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
        updatedAt: row.updated_at,
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

export async function listCalendarEmployeeChoices(): Promise<CalendarEmployeesResult> {
  try {
    const { data, error } = await supabase.rpc("list_calendar_employee_choices");
    if (error || !Array.isArray(data) || !data.every(isCalendarEmployeeChoiceRow)) {
      return employeesFailure();
    }
    return {
      ok: true,
      value: data.map((row) => ({ userId: row.user_id, fullName: row.full_name })),
    };
  } catch {
    return employeesFailure();
  }
}

export async function createCalendarEntry(
  input: CalendarEntryInput,
): Promise<CalendarMutationResult> {
  const normalized = normalizeCalendarEntryInput(input);
  if (!normalized) return mutationFailure("22023");
  try {
    const { data, error } = await supabase.rpc("create_calendar_entry", {
      p_entry_type: normalized.entryType,
      p_title: normalized.title,
      p_start_date: normalized.startDate,
      p_end_date: normalized.endDate,
      p_description: normalized.description,
      p_related_user_id: normalized.relatedUserId,
    });
    return mapMutationData(data, error !== null, error?.code);
  } catch {
    return mutationFailure();
  }
}

export async function updateCalendarEntry(
  id: string,
  expectedUpdatedAt: string,
  input: CalendarEntryInput,
): Promise<CalendarMutationResult> {
  const normalized = normalizeCalendarEntryInput(input);
  if (!isUuid(id) || !isTimestamp(expectedUpdatedAt) || !normalized) {
    return mutationFailure("22023");
  }
  try {
    const { data, error } = await supabase.rpc("update_calendar_entry", {
      p_calendar_entry_id: id,
      p_entry_type: normalized.entryType,
      p_title: normalized.title,
      p_start_date: normalized.startDate,
      p_end_date: normalized.endDate,
      p_description: normalized.description,
      p_related_user_id: normalized.relatedUserId,
      p_expected_updated_at: expectedUpdatedAt,
    });
    return mapMutationData(data, error !== null, error?.code);
  } catch {
    return mutationFailure();
  }
}

export async function deleteCalendarEntry(
  id: string,
  expectedUpdatedAt: string,
): Promise<CalendarMutationResult> {
  if (!isUuid(id) || !isTimestamp(expectedUpdatedAt)) return mutationFailure("22023");
  try {
    const { data, error } = await supabase.rpc("delete_calendar_entry", {
      p_calendar_entry_id: id,
      p_expected_updated_at: expectedUpdatedAt,
    });
    return mapMutationData(data, error !== null, error?.code);
  } catch {
    return mutationFailure();
  }
}
