import { describe, expect, it } from "vitest";

import type { WorkOrderListItem } from "./services/workOrderService";
import { filterWorkOrders } from "./workOrderSearch";

const workOrders: WorkOrderListItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000002",
    workOrderNumber: "RN-2026-0002",
    status: "finished",
    projectId: "00000000-0000-4000-8000-000000000020",
    projectName: "Alpha Cabinet",
    customerName: "Northwind",
    createdAt: "2026-09-22T10:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000001",
    workOrderNumber: "RN-2026-0001",
    status: "draft",
    projectId: null,
    projectName: null,
    customerName: null,
    createdAt: "2026-09-22T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    workOrderNumber: "RN-2025-0003",
    status: "draft",
    projectId: "00000000-0000-4000-8000-000000000030",
    projectName: "Beta Project",
    customerName: "Alpha Industries",
    createdAt: "2026-09-21T09:00:00.000Z",
  },
];

describe("filterWorkOrders", () => {
  it("returns all rows for blank search and All without mutating input", () => {
    const original = [...workOrders];
    const result = filterWorkOrders(workOrders, "   ", "all");

    expect(result).toEqual(workOrders);
    expect(result).not.toBe(workOrders);
    expect(workOrders).toEqual(original);
  });

  it.each([
    [" 2026-00 ", [workOrders[0], workOrders[1]]],
    ["ALPHA CAB", [workOrders[0]]],
    ["alpha ind", [workOrders[2]]],
  ])("searches number, Project, and Customer partially for %s", (search, expected) => {
    expect(filterWorkOrders(workOrders, search, "all")).toEqual(expected);
  });

  it("handles nullable Project and Customer fields without crashing", () => {
    expect(filterWorkOrders([workOrders[1]!], "missing", "all")).toEqual([]);
  });

  it("supports Draft and Finished filters", () => {
    expect(filterWorkOrders(workOrders, "", "draft"))
      .toEqual([workOrders[1], workOrders[2]]);
    expect(filterWorkOrders(workOrders, "", "finished"))
      .toEqual([workOrders[0]]);
  });

  it("composes status and search filters", () => {
    expect(filterWorkOrders(workOrders, "RN-2026", "draft"))
      .toEqual([workOrders[1]]);
    expect(filterWorkOrders(workOrders, "alpha", "draft"))
      .toEqual([workOrders[2]]);
  });
});
