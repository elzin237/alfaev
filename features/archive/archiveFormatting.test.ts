import { describe, expect, it } from "vitest";

import {
  compactArchiveRecordId,
  formatArchiveAction,
  formatArchiveDateTime,
  formatArchiveModule,
} from "./archiveFormatting";

describe("Archive formatting", () => {
  it.each([
    ["project", "Project"],
    ["calendar_entry", "Calendar"],
    ["work_order", "Work Order"],
    ["pcb_production_run", "PCB"],
    ["user_profile", "User"],
    ["user_permission", "Permissions"],
    ["product_inventory", "Inventory"],
    ["procurement_request", "Nabavka"],
  ])("maps known entity type %s to %s", (raw, label) => {
    expect(formatArchiveModule(raw)).toBe(label);
  });

  it("humanizes unknown entity types without hiding them", () => {
    expect(formatArchiveModule("future_quality_gate")).toBe("Future Quality Gate");
  });

  it("uses and humanizes the final action segment with a safe fallback", () => {
    expect(formatArchiveAction("calendar.created")).toBe("Created");
    expect(formatArchiveAction("future.bulk_reconciled")).toBe("Bulk Reconciled");
    expect(formatArchiveAction("customAction")).toBe("Custom Action");
  });

  it("formats the instant in the requested local zone without changing its source", () => {
    const source = "2026-10-01T23:30:00.123456+02:00";
    expect(formatArchiveDateTime(source, "UTC")).toBe("1 Oct 2026, 21:30");
    expect(source).toBe("2026-10-01T23:30:00.123456+02:00");
  });

  it("compacts a UUID deterministically", () => {
    expect(compactArchiveRecordId("12345678-1234-4234-8234-123456789abc"))
      .toBe("12345678…9abc");
  });
});
