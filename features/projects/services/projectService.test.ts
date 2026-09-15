import { beforeEach, describe, expect, it, vi } from "vitest";

const projectServiceMocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    from: projectServiceMocks.from,
    rpc: projectServiceMocks.rpc,
  },
}));

import {
  cancelProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "./projectService";

beforeEach(() => {
  vi.resetAllMocks();
  projectServiceMocks.from.mockReturnValue({
    select: projectServiceMocks.select,
  });
  projectServiceMocks.eq.mockReturnValue({
    maybeSingle: projectServiceMocks.maybeSingle,
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

  it("reads one exact Project, strictly maps its detail fields, and uses maybeSingle", async () => {
    projectServiceMocks.select.mockReturnValue({ eq: projectServiceMocks.eq });
    projectServiceMocks.maybeSingle.mockResolvedValue({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Control Cabinet",
        customer_name: "Alfa Customer",
        status: "in_progress",
        start_date: "2026-09-01",
        delivery_date: "2026-09-30",
        created_at: "2026-09-01T08:00:00.000Z",
        updated_at: "2026-09-10T09:30:00+00:00",
      },
      error: null,
    });

    await expect(getProject(
      "00000000-0000-4000-8000-000000000001",
    )).resolves.toEqual({
      ok: true,
      value: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Control Cabinet",
        customerName: "Alfa Customer",
        status: "in_progress",
        startDate: "2026-09-01",
        deliveryDate: "2026-09-30",
        createdAt: "2026-09-01T08:00:00.000Z",
        updatedAt: "2026-09-10T09:30:00+00:00",
      },
    });
    expect(projectServiceMocks.from).toHaveBeenCalledWith("projects");
    expect(projectServiceMocks.select).toHaveBeenCalledWith(
      "id,name,customer_name,status,start_date,delivery_date,created_at,updated_at",
    );
    expect(projectServiceMocks.eq).toHaveBeenCalledWith(
      "id",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(projectServiceMocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it("distinguishes a missing Project from safe provider and malformed-row failures", async () => {
    projectServiceMocks.select.mockReturnValue({ eq: projectServiceMocks.eq });
    projectServiceMocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    await expect(getProject(
      "00000000-0000-4000-8000-000000000001",
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "project_not_found",
        message: "The Project could not be found.",
      },
    });

    projectServiceMocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "raw provider details" },
    });
    await expect(getProject(
      "00000000-0000-4000-8000-000000000001",
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "project_detail_failed" },
    });

    projectServiceMocks.maybeSingle.mockResolvedValueOnce({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Project",
        customer_name: "Customer",
        status: "completed",
        start_date: "2026-09-01",
        delivery_date: "2026-09-30",
        created_at: "not-a-timestamp",
        updated_at: "2026-09-10T09:30:00Z",
      },
      error: null,
    });
    await expect(getProject(
      "00000000-0000-4000-8000-000000000001",
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "project_detail_failed" },
    });
  });

  it("rejects a malformed Project ID without querying Supabase", async () => {
    await expect(getProject("not-a-project-id")).resolves.toEqual({
      ok: false,
      error: {
        code: "project_not_found",
        message: "The Project could not be found.",
      },
    });
    expect(projectServiceMocks.from).not.toHaveBeenCalled();
  });

  it("creates through only the trusted RPC with normalized canonical inputs", async () => {
    projectServiceMocks.rpc.mockResolvedValue({
      data: "00000000-0000-4000-8000-000000000010",
      error: null,
    });

    await expect(createProject({
      name: "  Control Cabinet  ",
      customerName: "  Alfa Customer  ",
      startDate: "2026-09-01",
      deliveryDate: "2026-09-30",
    })).resolves.toEqual({
      ok: true,
      value: { projectId: "00000000-0000-4000-8000-000000000010" },
    });
    expect(projectServiceMocks.rpc).toHaveBeenCalledWith("create_project", {
      p_name: "Control Cabinet",
      p_customer_name: "Alfa Customer",
      p_start_date: "2026-09-01",
      p_delivery_date: "2026-09-30",
    });
    expect(projectServiceMocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "access_denied", "You do not have permission to create Projects."],
    ["22007", "project_invalid", "Enter valid Project details and dates."],
    ["22008", "project_invalid", "Enter valid Project details and dates."],
    ["22023", "project_invalid", "Enter valid Project details and dates."],
    ["23514", "project_invalid", "Enter valid Project details and dates."],
    ["XX000", "project_create_failed", "The Project could not be created. Please try again."],
  ])("maps %s creation failures to safe error %s", async (
    backendCode,
    code,
    message,
  ) => {
    projectServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw provider details" },
    });

    await expect(createProject({
      name: "Project",
      customerName: "Customer",
      startDate: "2026-09-01",
      deliveryDate: "2026-09-30",
    })).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("fails safely when creation returns malformed data or throws", async () => {
    projectServiceMocks.rpc.mockResolvedValueOnce({
      data: "not-a-project-id",
      error: null,
    });
    await expect(createProject({
      name: "Project",
      customerName: "Customer",
      startDate: "2026-09-01",
      deliveryDate: "2026-09-30",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "project_create_failed" },
    });

    projectServiceMocks.rpc.mockRejectedValueOnce(
      new Error("raw network details"),
    );
    await expect(createProject({
      name: "Project",
      customerName: "Customer",
      startDate: "2026-09-01",
      deliveryDate: "2026-09-30",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "project_create_failed" },
    });
  });

  it("updates only through the trusted RPC with normalized Project fields", async () => {
    projectServiceMocks.rpc.mockResolvedValue({ data: "00000000-0000-4000-8000-000000000001", error: null });

    await expect(updateProject("00000000-0000-4000-8000-000000000001", {
      name: "  Updated Project  ",
      customerName: "  Updated Customer  ",
      startDate: "2026-09-02",
      deliveryDate: "2026-09-30",
      status: "in_progress",
    })).resolves.toEqual({
      ok: true,
      value: { projectId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(projectServiceMocks.rpc).toHaveBeenCalledWith("update_project", {
      p_project_id: "00000000-0000-4000-8000-000000000001",
      p_name: "Updated Project",
      p_customer_name: "Updated Customer",
      p_start_date: "2026-09-02",
      p_delivery_date: "2026-09-30",
      p_status: "in_progress",
    });
    expect(projectServiceMocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "access_denied"],
    ["PRJ01", "project_cancelled"],
    ["PRJ02", "project_completed"],
    ["22023", "project_invalid"],
    ["P0002", "project_not_found"],
    ["XX000", "project_update_failed"],
  ])("maps update error %s safely", async (backendCode, expectedCode) => {
    projectServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw database detail" },
    });
    const result = await updateProject(
      "00000000-0000-4000-8000-000000000001",
      {
        name: "Project",
        customerName: "Customer",
        startDate: "2026-09-01",
        deliveryDate: "2026-09-30",
        status: "planned",
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    if (!result.ok) expect(result.error.message).not.toContain("raw");
  });

  it("maps the Completed lifecycle lock to safe read-only copy", async () => {
    projectServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PRJ02", message: "raw database detail" },
    });
    await expect(updateProject(
      "00000000-0000-4000-8000-000000000001",
      {
        name: "Project",
        customerName: "Customer",
        startDate: "2026-09-01",
        deliveryDate: "2026-09-30",
        status: "completed",
      },
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "project_completed",
        message: "Completed Projects cannot be edited.",
      },
    });
  });

  it("cancels only through the trusted cancellation RPC", async () => {
    projectServiceMocks.rpc.mockResolvedValue({ data: "00000000-0000-4000-8000-000000000001", error: null });

    await expect(cancelProject(
      "00000000-0000-4000-8000-000000000001",
    )).resolves.toEqual({
      ok: true,
      value: { projectId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(projectServiceMocks.rpc).toHaveBeenCalledWith("cancel_project", {
      p_project_id: "00000000-0000-4000-8000-000000000001",
    });
  });

  it.each([
    ["42501", "access_denied"],
    ["PRJ03", "project_state_invalid"],
    ["P0002", "project_not_found"],
    ["XX000", "project_cancel_failed"],
  ])("maps cancellation error %s safely", async (backendCode, expectedCode) => {
    projectServiceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "raw database detail" },
    });
    const result = await cancelProject(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    if (!result.ok) expect(result.error.message).not.toContain("raw");
  });

  it("fails mutations safely for malformed results and thrown errors", async () => {
    projectServiceMocks.rpc.mockResolvedValueOnce({ data: "bad-id", error: null });
    await expect(cancelProject(
      "00000000-0000-4000-8000-000000000001",
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "project_cancel_failed" },
    });

    projectServiceMocks.rpc.mockRejectedValueOnce(new Error("raw network detail"));
    await expect(updateProject(
      "00000000-0000-4000-8000-000000000001",
      {
        name: "Project",
        customerName: "Customer",
        startDate: "2026-09-01",
        deliveryDate: "2026-09-30",
        status: "planned",
      },
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "project_update_failed" },
    });
  });
});
