import { beforeEach, describe, expect, it, vi } from "vitest";

const calendarServiceMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../../lib/supabase/client", () => ({
  supabase: {
    from: calendarServiceMocks.from,
    rpc: calendarServiceMocks.rpc,
  },
}));

import {
  createCalendarEntry,
  deleteCalendarEntry,
  listCalendarBirthdays,
  listCalendarEmployeeChoices,
  listCalendarEntries,
  updateCalendarEntry,
} from "./calendarService";

const entryRow = {
  id: "00000000-0000-4000-8000-000000000001",
  entry_type: "business_trip",
  title: "Supplier visit",
  start_date: "2026-09-28",
  end_date: "2026-10-02",
  description: "Factory acceptance visit",
  related_user_id: "00000000-0000-4000-8000-000000000002",
  updated_at: "2026-09-20T12:34:56.123456+00:00",
};
const birthdayRow = {
  user_id: "00000000-0000-4000-8000-000000000003",
  full_name: "Alfa User",
  birthday: "1992-02-29",
};
const mutationRow = {
  calendar_entry_id: entryRow.id,
  calendar_entry_updated_at: "2026-10-01T08:00:00.654321+00:00",
};
const input = {
  entryType: "event" as const,
  title: "  Safety review  ",
  startDate: "2026-10-02",
  endDate: "2026-10-03",
  description: "  Review safely  ",
  relatedUserId: entryRow.related_user_id,
};

beforeEach(() => {
  vi.resetAllMocks();
  calendarServiceMocks.from.mockReturnValue({
    select: calendarServiceMocks.select,
  });
});

describe("calendarService", () => {
  it("reads the narrow CalendarEntry projection and maps canonical fields", async () => {
    calendarServiceMocks.select.mockResolvedValue({ data: [entryRow], error: null });

    await expect(listCalendarEntries()).resolves.toEqual({
      ok: true,
      value: [{
        id: entryRow.id,
        entryType: "business_trip",
        title: "Supplier visit",
        startDate: "2026-09-28",
        endDate: "2026-10-02",
        description: "Factory acceptance visit",
        relatedUserId: entryRow.related_user_id,
        updatedAt: entryRow.updated_at,
      }],
    });
    expect(calendarServiceMocks.from).toHaveBeenCalledWith("calendar_entries");
    expect(calendarServiceMocks.select).toHaveBeenCalledWith(
      "id,entry_type,title,start_date,end_date,description,related_user_id,updated_at",
    );
  });

  it.each([
    { ...entryRow, id: "bad-id" },
    { ...entryRow, entry_type: "birthday" },
    { ...entryRow, title: " Untrimmed " },
    { ...entryRow, start_date: "2026-02-30" },
    { ...entryRow, start_date: "2026-10-03", end_date: "2026-10-02" },
    { ...entryRow, description: " " },
    { ...entryRow, related_user_id: "bad-id" },
    { ...entryRow, updated_at: "2026-02-30T12:00:00+00:00" },
    { ...entryRow, created_at: "2026-09-01T00:00:00Z" },
  ])("fails safely for malformed or over-broad CalendarEntry rows", async (row) => {
    calendarServiceMocks.select.mockResolvedValue({ data: [row], error: null });

    await expect(listCalendarEntries()).resolves.toEqual({
      ok: false,
      error: {
        code: "calendar_entries_failed",
        message: "Calendar entries could not be loaded.",
      },
    });
  });

  it("reads birthdays only through the narrow RPC and preserves date-only text", async () => {
    calendarServiceMocks.rpc.mockResolvedValue({ data: [birthdayRow], error: null });

    await expect(listCalendarBirthdays()).resolves.toEqual({
      ok: true,
      value: [{
        userId: birthdayRow.user_id,
        fullName: "Alfa User",
        birthday: "1992-02-29",
      }],
    });
    expect(calendarServiceMocks.rpc).toHaveBeenCalledWith(
      "list_calendar_birthdays",
    );
    expect(calendarServiceMocks.from).not.toHaveBeenCalledWith("user_profiles");
  });

  it("reads narrow Admin employee choices without exposing user security fields", async () => {
    calendarServiceMocks.rpc.mockResolvedValue({
      data: [{ user_id: entryRow.related_user_id, full_name: "Related Person" }],
      error: null,
    });

    await expect(listCalendarEmployeeChoices()).resolves.toEqual({
      ok: true,
      value: [{ userId: entryRow.related_user_id, fullName: "Related Person" }],
    });
    expect(calendarServiceMocks.rpc).toHaveBeenCalledWith(
      "list_calendar_employee_choices",
    );

    calendarServiceMocks.rpc.mockResolvedValue({
      data: [{ user_id: entryRow.related_user_id, full_name: "Related Person", email: "hidden@example.com" }],
      error: null,
    });
    await expect(listCalendarEmployeeChoices()).resolves.toMatchObject({
      ok: false,
      error: { code: "calendar_employees_failed" },
    });
  });

  it("normalizes and sends the exact trusted create/update/delete payloads", async () => {
    calendarServiceMocks.rpc.mockResolvedValue({ data: [mutationRow], error: null });

    await expect(createCalendarEntry(input)).resolves.toEqual({
      ok: true,
      value: { id: mutationRow.calendar_entry_id, updatedAt: mutationRow.calendar_entry_updated_at },
    });
    expect(calendarServiceMocks.rpc).toHaveBeenLastCalledWith("create_calendar_entry", {
      p_entry_type: "event",
      p_title: "Safety review",
      p_start_date: "2026-10-02",
      p_end_date: "2026-10-03",
      p_description: "Review safely",
      p_related_user_id: entryRow.related_user_id,
    });

    await updateCalendarEntry(entryRow.id, entryRow.updated_at, {
      ...input,
      description: "   ",
    });
    expect(calendarServiceMocks.rpc).toHaveBeenLastCalledWith("update_calendar_entry", {
      p_calendar_entry_id: entryRow.id,
      p_entry_type: "event",
      p_title: "Safety review",
      p_start_date: "2026-10-02",
      p_end_date: "2026-10-03",
      p_description: null,
      p_related_user_id: entryRow.related_user_id,
      p_expected_updated_at: entryRow.updated_at,
    });

    await deleteCalendarEntry(entryRow.id, entryRow.updated_at);
    expect(calendarServiceMocks.rpc).toHaveBeenLastCalledWith("delete_calendar_entry", {
      p_calendar_entry_id: entryRow.id,
      p_expected_updated_at: entryRow.updated_at,
    });
  });

  it.each([
    ["42501", "access_denied"],
    ["P0002", "not_found"],
    ["CAL01", "stale_entry"],
    ["22023", "invalid_input"],
    ["XX000", "calendar_mutation_failed"],
  ])("maps backend %s safely to %s", async (providerCode, expectedCode) => {
    calendarServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw provider secret" },
    });
    const result = await createCalendarEntry(input);
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(JSON.stringify(result)).not.toContain("raw provider secret");
  });

  it("rejects Birthday, malformed dates, bad UUIDs, and malformed mutation responses before trusting them", async () => {
    await expect(createCalendarEntry({ ...input, entryType: "birthday" as never }))
      .resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    await expect(createCalendarEntry({ ...input, endDate: "2026-09-30" }))
      .resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    await expect(updateCalendarEntry("bad-id", entryRow.updated_at, input))
      .resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(calendarServiceMocks.rpc).not.toHaveBeenCalled();

    calendarServiceMocks.rpc.mockResolvedValue({
      data: [{ ...mutationRow, email: "not allowed" }],
      error: null,
    });
    await expect(deleteCalendarEntry(entryRow.id, entryRow.updated_at))
      .resolves.toMatchObject({ ok: false, error: { code: "calendar_mutation_failed" } });
  });

  it.each([
    { ...birthdayRow, user_id: "bad-id" },
    { ...birthdayRow, full_name: " Alfa User" },
    { ...birthdayRow, birthday: "1991-02-29" },
    { ...birthdayRow, email: "sensitive@example.com" },
    { ...birthdayRow, is_admin: false },
  ])("rejects malformed or over-broad Birthday rows", async (row) => {
    calendarServiceMocks.rpc.mockResolvedValue({ data: [row], error: null });

    await expect(listCalendarBirthdays()).resolves.toEqual({
      ok: false,
      error: {
        code: "calendar_birthdays_failed",
        message: "Calendar birthdays could not be loaded.",
      },
    });
  });

  it("maps provider and thrown failures to safe source-specific errors", async () => {
    calendarServiceMocks.select.mockResolvedValue({
      data: null,
      error: { message: "raw entry details" },
    });
    calendarServiceMocks.rpc.mockRejectedValue(new Error("raw birthday details"));

    const entries = await listCalendarEntries();
    const birthdays = await listCalendarBirthdays();

    expect(entries).toEqual({
      ok: false,
      error: {
        code: "calendar_entries_failed",
        message: "Calendar entries could not be loaded.",
      },
    });
    expect(birthdays).toEqual({
      ok: false,
      error: {
        code: "calendar_birthdays_failed",
        message: "Calendar birthdays could not be loaded.",
      },
    });
    expect(JSON.stringify([entries, birthdays])).not.toMatch(/raw .* details/);
  });
});
