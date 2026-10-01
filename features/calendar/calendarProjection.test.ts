import { describe, expect, it } from "vitest";

import {
  addCalendarMonths,
  buildMonthGrid,
  parseDateOnly,
} from "./calendarDate";
import {
  buildCalendarEventsForYear,
  calendarEventsOnDate,
} from "./calendarProjection";
import type {
  CalendarBirthday,
  CalendarCategory,
  CalendarEntry,
} from "./calendarTypes";

const entries: CalendarEntry[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    entryType: "event",
    title: "Single day",
    startDate: "2026-09-15",
    endDate: "2026-09-15",
    description: null,
    relatedUserId: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    entryType: "business_trip",
    title: "Month boundary",
    startDate: "2026-09-30",
    endDate: "2026-10-02",
    description: null,
    relatedUserId: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    entryType: "vacation",
    title: "Year boundary",
    startDate: "2026-12-31",
    endDate: "2027-01-02",
    description: null,
    relatedUserId: null,
  },
];
const allCategories = new Set<CalendarCategory>([
  "birthday",
  "business_trip",
  "event",
  "vacation",
]);

describe("Calendar date-only projection", () => {
  it("parses and validates dates without local-time Date parsing", () => {
    expect(parseDateOnly("2026-09-15")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateOnly("2026-02-29")).toBeNull();
    expect(parseDateOnly("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDateOnly("2026-9-15")).toBeNull();
  });

  it("builds a stable six-week Monday-first grid with outside-month days", () => {
    const grid = buildMonthGrid({ year: 2026, month: 9 });

    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: "2026-08-31", day: 31, isCurrentMonth: false });
    expect(grid[1]).toEqual({ date: "2026-09-01", day: 1, isCurrentMonth: true });
    expect(grid[41]).toEqual({ date: "2026-10-11", day: 11, isCurrentMonth: false });
    expect(addCalendarMonths({ year: 2026, month: 1 }, -1))
      .toEqual({ year: 2025, month: 12 });
  });

  it("projects single-day and inclusive multi-day entries across month and year boundaries", () => {
    const events = buildCalendarEventsForYear(entries, [], 2026);

    expect(calendarEventsOnDate(events, "2026-09-15", allCategories)
      .map((event) => event.title)).toEqual(["Single day"]);
    expect(calendarEventsOnDate(events, "2026-09-30", allCategories)
      .map((event) => event.title)).toEqual(["Month boundary"]);
    expect(calendarEventsOnDate(events, "2026-10-01", allCategories)
      .map((event) => event.title)).toEqual(["Month boundary"]);
    expect(calendarEventsOnDate(events, "2026-10-02", allCategories)
      .map((event) => event.title)).toEqual(["Month boundary"]);
    expect(calendarEventsOnDate(events, "2026-10-03", allCategories)).toEqual([]);
    expect(calendarEventsOnDate(events, "2026-12-31", allCategories)
      .map((event) => event.title)).toEqual(["Year boundary"]);
    expect(calendarEventsOnDate(events, "2027-01-02", allCategories)
      .map((event) => event.title)).toEqual(["Year boundary"]);
  });

  it("derives Birthday occurrence by month/day without age or stored-year display", () => {
    const birthdays: CalendarBirthday[] = [{
      userId: "00000000-0000-4000-8000-000000000010",
      fullName: "Leap User",
      birthday: "1992-02-29",
    }];
    const leapEvents = buildCalendarEventsForYear([], birthdays, 2028);
    const ordinaryEvents = buildCalendarEventsForYear([], birthdays, 2027);

    expect(leapEvents).toEqual([{
      id: "birthday:00000000-0000-4000-8000-000000000010:2028-02-29",
      category: "birthday",
      title: "Leap User",
      label: "Birthday: Leap User",
      startDate: "2028-02-29",
      endDate: "2028-02-29",
      description: null,
    }]);
    expect(JSON.stringify(leapEvents)).not.toContain("1992");
    expect(JSON.stringify(leapEvents)).not.toMatch(/age/i);
    expect(ordinaryEvents).toEqual([]);
  });

  it("filters categories independently without changing the projected data", () => {
    const events = buildCalendarEventsForYear(entries, [], 2026);
    const eventOnly = new Set<CalendarCategory>(["event"]);
    const none = new Set<CalendarCategory>();

    expect(calendarEventsOnDate(events, "2026-09-15", eventOnly)).toHaveLength(1);
    expect(calendarEventsOnDate(events, "2026-09-30", eventOnly)).toEqual([]);
    expect(calendarEventsOnDate(events, "2026-09-15", none)).toEqual([]);
    expect(events).toHaveLength(3);
  });
});
