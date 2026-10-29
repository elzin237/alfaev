import { describe, expect, it } from "vitest";
import { formatHistoryDeadline, formatHistoryTimestamp } from "./testCalculationHistoryDates";

describe("saved history Sarajevo date presentation", () => {
  it.each([
    ["2026-10-28T13:18:00Z", "28 Oct 2026 · 14:18"],
    ["2026-07-01T22:30:00Z", "2 Jul 2026 · 00:30"],
    ["2026-12-31T23:30:00Z", "1 Jan 2027 · 00:30"],
    ["2026-03-29T00:59:00Z", "29 Mar 2026 · 01:59"],
    ["2026-03-29T01:00:00Z", "29 Mar 2026 · 03:00"],
    ["2026-10-25T00:59:00Z", "25 Oct 2026 · 02:59"],
    ["2026-10-25T01:00:00Z", "25 Oct 2026 · 02:00"],
    ["2026-10-28T14:18:00.123456+01:00", "28 Oct 2026 · 14:18"],
  ])("formats stored instant %s without relying on the browser timezone", (instant, expected) => {
    expect(formatHistoryTimestamp(instant)).toBe(expected);
  });

  it.each([
    ["2026-03-29", "29 Mar 2026"], ["2026-10-25", "25 Oct 2026"],
    ["2026-12-31", "31 Dec 2026"], ["2028-02-29", "29 Feb 2028"],
  ])("keeps date-only deadline %s on its original Sarajevo calendar day", (date, expected) => {
    expect(formatHistoryDeadline(date)).toBe(expected);
  });
});
