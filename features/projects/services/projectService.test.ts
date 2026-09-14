import { beforeEach, describe, expect, it, vi } from "vitest";

const projectServiceMocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { from: projectServiceMocks.from },
}));

import { listProjects } from "./projectService";

beforeEach(() => {
  vi.resetAllMocks();
  projectServiceMocks.from.mockReturnValue({
    select: projectServiceMocks.select,
  });
});

describe("projectService", () => {
  it("reads the RLS-protected Projects table, maps canonical fields, and orders deterministically", async () => {
    projectServiceMocks.select.mockResolvedValue({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Later Project",
          customer_name: "Customer C",
          status: "completed",
          start_date: "2026-10-01",
          delivery_date: "2026-10-20",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          name: "Beta Project",
          customer_name: "Customer B",
          status: "in_progress",
          start_date: "2026-09-01",
          delivery_date: "2026-09-20",
        },
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Alpha Project",
          customer_name: "Customer A",
          status: "planned",
          start_date: "2026-09-01",
          delivery_date: "2026-09-20",
        },
      ],
      error: null,
    });

    await expect(listProjects()).resolves.toEqual({
      ok: true,
      value: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Alpha Project",
          customerName: "Customer A",
          status: "planned",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-20",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          name: "Beta Project",
          customerName: "Customer B",
          status: "in_progress",
          startDate: "2026-09-01",
          deliveryDate: "2026-09-20",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Later Project",
          customerName: "Customer C",
          status: "completed",
          startDate: "2026-10-01",
          deliveryDate: "2026-10-20",
        },
      ],
    });
    expect(projectServiceMocks.from).toHaveBeenCalledWith("projects");
    expect(projectServiceMocks.select).toHaveBeenCalledWith(
      "id,name,customer_name,status,start_date,delivery_date",
    );
  });

  it.each([
    ["invalid UUID", {
      id: "project-1",
      name: "Project",
      customer_name: "Customer",
      status: "planned",
      start_date: "2026-09-01",
      delivery_date: "2026-09-20",
    }],
    ["untrimmed name", {
      id: "00000000-0000-4000-8000-000000000001",
      name: " Project ",
      customer_name: "Customer",
      status: "planned",
      start_date: "2026-09-01",
      delivery_date: "2026-09-20",
    }],
    ["unknown status", {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Project",
      customer_name: "Customer",
      status: "archived",
      start_date: "2026-09-01",
      delivery_date: "2026-09-20",
    }],
    ["invalid date", {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Project",
      customer_name: "Customer",
      status: "planned",
      start_date: "2026-02-30",
      delivery_date: "2026-09-20",
    }],
  ])("fails safely for a malformed Project row with %s", async (_label, row) => {
    projectServiceMocks.select.mockResolvedValue({ data: [row], error: null });

    await expect(listProjects()).resolves.toEqual({
      ok: false,
      error: {
        code: "project_list_failed",
        message: "The Project list could not be loaded.",
      },
    });
  });

  it("maps provider failures and thrown errors to safe list errors", async () => {
    projectServiceMocks.select.mockResolvedValueOnce({
      data: null,
      error: { message: "raw database details" },
    });
    await expect(listProjects()).resolves.toEqual({
      ok: false,
      error: {
        code: "project_list_failed",
        message: "The Project list could not be loaded.",
      },
    });

    projectServiceMocks.select.mockRejectedValueOnce(
      new Error("raw network details"),
    );
    await expect(listProjects()).resolves.toEqual({
      ok: false,
      error: {
        code: "project_list_failed",
        message: "The Project list could not be loaded.",
      },
    });
  });
});
