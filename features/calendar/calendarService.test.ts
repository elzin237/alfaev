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
  listCalendarBirthdays,
  listCalendarEntries,
} from "./calendarService";

const entryRow = {
  id: "00000000-0000-4000-8000-000000000001",
  entry_type: "business_trip",
  title: "Supplier visit",
  start_date: "2026-09-28",
  end_date: "2026-10-02",
  description: "Factory acceptance visit",
  related_user_id: "00000000-0000-4000-8000-000000000002",
};
const birthdayRow = {
  user_id: "00000000-0000-4000-8000-000000000003",
  full_name: "Alfa User",
  birthday: "1992-02-29",
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
      }],
    });
    expect(calendarServiceMocks.from).toHaveBeenCalledWith("calendar_entries");
    expect(calendarServiceMocks.select).toHaveBeenCalledWith(
      "id,entry_type,title,start_date,end_date,description,related_user_id",
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
