import { afterEach, describe, expect, it } from "vitest";

import {
  countActiveArchiveFilters,
  EMPTY_ARCHIVE_FILTERS,
  localDateStartAsUtc,
  normalizeArchiveFilters,
} from "./archiveFilters";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimeZone;
});

describe("Archive filters", () => {
  it("normalizes optional text without changing authoritative timestamp filters", () => {
    expect(normalizeArchiveFilters({
      ...EMPTY_ARCHIVE_FILTERS,
      createdFrom: "2026-01-01T00:00:00.000Z",
      entityType: " project ",
      actionType: " ",
      searchText: "  Alpha  ",
    })).toEqual({
      ...EMPTY_ARCHIVE_FILTERS,
      createdFrom: "2026-01-01T00:00:00.000Z",
      entityType: "project",
      actionType: null,
      searchText: "Alpha",
    });
  });

  it("converts inclusive local calendar dates to exact UTC range boundaries", () => {
    process.env.TZ = "Europe/Sarajevo";
    expect(localDateStartAsUtc("2026-01-15")).toBe("2026-01-14T23:00:00.000Z");
    expect(localDateStartAsUtc("2026-01-15", true)).toBe("2026-01-15T23:00:00.000Z");
    expect(localDateStartAsUtc("not-a-date")).toBeNull();
  });

  it("uses the next local midnight across a daylight-saving transition", () => {
    process.env.TZ = "Europe/Sarajevo";
    const start = localDateStartAsUtc("2026-03-29");
    const exclusiveEnd = localDateStartAsUtc("2026-03-29", true);
    expect(start).toBe("2026-03-28T23:00:00.000Z");
    expect(exclusiveEnd).toBe("2026-03-29T22:00:00.000Z");
    expect(Date.parse(exclusiveEnd!) - Date.parse(start!)).toBe(23 * 60 * 60 * 1000);
  });

  it("counts each active filter dimension once", () => {
    expect(countActiveArchiveFilters(EMPTY_ARCHIVE_FILTERS)).toBe(0);
    expect(countActiveArchiveFilters({
      createdFrom: "from",
      createdBefore: "before",
      actorUserId: "actor",
      entityType: "entity",
      actionType: "action",
      searchText: "many characters still count once",
    })).toBe(6);
  });
});
