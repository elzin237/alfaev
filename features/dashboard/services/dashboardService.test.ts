import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { getDashboardReadModel } from "./dashboardService";

const projectOne = "00000000-0000-4000-8000-000000000001";
const projectTwo = "00000000-0000-4000-8000-000000000002";
const workOrderOne = "00000000-0000-4000-8000-000000000003";
const workOrderTwo = "00000000-0000-4000-8000-000000000004";
const actorId = "00000000-0000-4000-8000-000000000005";
const productionRunId = "00000000-0000-4000-8000-000000000010";

function validResponse() {
  return {
    projects: {
      status_counts: {
        planned: 1,
        in_progress: 2,
        on_hold: 3,
        completed: 4,
        cancelled: 5,
      },
      recent: [
        {
          id: projectTwo,
          name: "Second Project",
          customer_name: "Customer B",
          status: "in_progress",
          delivery_date: "2026-10-20",
          updated_at: "2026-10-01T11:00:00.123456+02:00",
        },
        {
          id: projectOne,
          name: "First Project",
          customer_name: "Customer A",
          status: "planned",
          delivery_date: "2026-10-18",
          updated_at: "2026-10-01T10:00:00+02:00",
        },
      ],
    },
    work_orders: {
      recent: [
        {
          id: workOrderTwo,
          work_order_number: "RN-2026-0002",
          status: "finished",
          project_id: projectTwo,
          customer_name_snapshot: "Customer B",
          created_at: "2026-09-30T09:00:00+02:00",
          updated_at: "2026-10-01T11:30:00+02:00",
          finished_at: "2026-10-01T11:30:00+02:00",
        },
        {
          id: workOrderOne,
          work_order_number: "RN-2026-0001",
          status: "draft",
          project_id: null,
          customer_name_snapshot: null,
          created_at: "2026-09-30T08:00:00+02:00",
          updated_at: "2026-10-01T10:30:00+02:00",
          finished_at: null,
        },
      ],
    },
    procurement: {
      unresolved_count: 1,
      unresolved: [{
        id: "00000000-0000-4000-8000-000000000006",
        requested_name: "Connector",
        status: "partly_delivered",
        requested_quantity: "9007199254740993",
        delivered_quantity: "1",
        remaining_quantity: "9007199254740992",
        product_serial_number: "1234567",
        created_at: "2026-09-29T08:00:00Z",
        updated_at: "2026-10-01T08:00:00Z",
      }],
    },
    inventory: {
      active_product_count: 1,
      recent: [{
        product_id: "00000000-0000-4000-8000-000000000007",
        serial_number: "7654321",
        name: "Controller",
        category: "PCB",
        quantity: "9223372036854775807",
        updated_at: "2026-10-01T08:00:00Z",
      }],
    },
    activity: {
      recent: [{
        audit_log_id: "00000000-0000-4000-8000-000000000008",
        actor_user_id: actorId,
        actor_full_name: "Historical Actor",
        action_type: "project.updated",
        entity_type: "project",
        entity_id: projectOne,
        summary: "Updated Project",
        created_at: "2026-10-01T08:00:00Z",
      }],
    },
    calendar: {
      upcoming: [{
        kind: "event",
        id: "00000000-0000-4000-8000-000000000009",
        title: "Company event",
        start_date: "2026-10-10",
        end_date: "2026-10-11",
        related_user_id: null,
      }],
    },
  };
}

beforeEach(() => vi.resetAllMocks());

describe("dashboardService", () => {
  it("calls the one parameter-free Dashboard RPC exactly once and parses every section", async () => {
    mocks.rpc.mockResolvedValue({ data: validResponse(), error: null });

    const result = await getDashboardReadModel();

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_dashboard_read_model");
    expect(result).toMatchObject({
      ok: true,
      value: {
        projects: {
          statusCounts: { inProgress: 2, onHold: 3 },
          recent: [{ id: projectTwo }, { id: projectOne }],
        },
        workOrders: {
          recent: [{ id: workOrderTwo }, { id: workOrderOne }],
        },
        procurement: {
          unresolved: [{ requestedQuantity: "9007199254740993" }],
        },
        inventory: {
          recent: [{ quantity: "9223372036854775807" }],
        },
        activity: { recent: [{ actorUserId: actorId }] },
        calendar: { upcoming: [{ title: "Company event" }] },
      },
    });
  });

  it("accepts every protected section as null while preserving Calendar", async () => {
    const response = validResponse();
    response.projects = null as never;
    response.work_orders = null as never;
    response.procurement = null as never;
    response.inventory = null as never;
    response.activity = null as never;
    mocks.rpc.mockResolvedValue({ data: response, error: null });

    await expect(getDashboardReadModel()).resolves.toMatchObject({
      ok: true,
      value: {
        projects: null,
        workOrders: null,
        procurement: null,
        inventory: null,
        activity: null,
        calendar: { upcoming: expect.any(Array) },
      },
    });
  });

  it("preserves backend Project and Work Order row ordering", async () => {
    mocks.rpc.mockResolvedValue({ data: validResponse(), error: null });
    const result = await getDashboardReadModel();
    if (!result.ok) throw new Error("Expected valid Dashboard data");

    expect(result.value.projects?.recent.map((item) => item.id))
      .toEqual([projectTwo, projectOne]);
    expect(result.value.workOrders?.recent.map((item) => item.id))
      .toEqual([workOrderTwo, workOrderOne]);
  });

  it("accepts PCB production Activity and a finished General Stock Work Order", async () => {
    const response = validResponse();
    Object.assign(response.work_orders.recent[0]!, {
      work_order_number: "RN-2026-0013",
      project_id: null,
      customer_name_snapshot: null,
    });
    response.activity.recent = [
      {
        audit_log_id: "00000000-0000-4000-8000-000000000011",
        actor_user_id: actorId,
        actor_full_name: "Vladan Markovic",
        action_type: "pcb_production.completed",
        entity_type: "pcb_production_run",
        entity_id: productionRunId,
        summary: "Completed PCB production Work Order RN-2026-0013",
        created_at: "2026-10-05T11:20:04.934482+00:00",
      },
      {
        audit_log_id: "00000000-0000-4000-8000-000000000012",
        actor_user_id: actorId,
        actor_full_name: "Vladan Markovic",
        action_type: "pcb_production.work_order_created",
        entity_type: "work_order",
        entity_id: workOrderTwo,
        summary: "Created PCB production Work Order RN-2026-0013",
        created_at: "2026-10-05T11:15:47.246966+00:00",
      },
    ];
    mocks.rpc.mockResolvedValue({ data: response, error: null });

    const result = await getDashboardReadModel();

    if (!result.ok) throw new Error("Expected valid PCB production Dashboard data");
    expect(result.value.workOrders?.recent[0]).toMatchObject({
      workOrderNumber: "RN-2026-0013",
      projectId: null,
      customerNameSnapshot: null,
      status: "finished",
    });
    expect(result.value.activity?.recent).toEqual([
      expect.objectContaining({
        actionType: "pcb_production.completed",
        entityType: "pcb_production_run",
        summary: "Completed PCB production Work Order RN-2026-0013",
      }),
      expect.objectContaining({
        actionType: "pcb_production.work_order_created",
        entityType: "work_order",
      }),
    ]);
  });

  it.each([
    ["action type", "action_type", "future_module.recorded"],
    ["entity type", "entity_type", "future_module_record"],
  ] as const)("accepts a structurally valid future Activity %s", async (
    _label,
    field,
    value,
  ) => {
    const response = validResponse();
    response.activity.recent[0]![field] = value;
    mocks.rpc.mockResolvedValue({ data: response, error: null });

    await expect(getDashboardReadModel()).resolves.toMatchObject({
      ok: true,
      value: { activity: { recent: [{
        [field === "action_type" ? "actionType" : "entityType"]: value,
      }] } },
    });
  });

  it.each([
    ["blank action type", (value: ReturnType<typeof validResponse>) => {
      value.activity.recent[0]!.action_type = "";
    }],
    ["untrimmed entity type", (value: ReturnType<typeof validResponse>) => {
      value.activity.recent[0]!.entity_type = " project";
    }],
    ["invalid audit ID", (value: ReturnType<typeof validResponse>) => {
      value.activity.recent[0]!.audit_log_id = "not-a-uuid";
    }],
    ["invalid timestamp", (value: ReturnType<typeof validResponse>) => {
      value.activity.recent[0]!.created_at = "now";
    }],
  ])("rejects malformed Activity data: %s", async (_label, mutate) => {
    const response = validResponse();
    mutate(response);
    mocks.rpc.mockResolvedValue({ data: response, error: null });

    await expect(getDashboardReadModel()).resolves.toMatchObject({ ok: false });
  });

  it.each([
    ["null top level", null],
    ["array top level", []],
    ["missing section", (() => {
      const { calendar: _calendar, ...value } = validResponse();
      return value;
    })()],
    ["unexpected top-level field", { ...validResponse(), email: "hidden" }],
  ])("fails safely for %s", async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getDashboardReadModel()).resolves.toEqual({
      ok: false,
      error: {
        code: "dashboard_load_failed",
        message: "The Dashboard overview could not be loaded.",
      },
    });
  });

  it.each([
    ["negative count", (value: ReturnType<typeof validResponse>) => {
      value.projects.status_counts.planned = -1;
    }],
    ["unknown status", (value: ReturnType<typeof validResponse>) => {
      value.projects.recent[0]!.status = "unknown";
    }],
    ["invalid UUID", (value: ReturnType<typeof validResponse>) => {
      value.projects.recent[0]!.id = "not-a-uuid";
    }],
    ["invalid date", (value: ReturnType<typeof validResponse>) => {
      value.projects.recent[0]!.delivery_date = "2026-02-30";
    }],
    ["invalid timestamp", (value: ReturnType<typeof validResponse>) => {
      value.projects.recent[0]!.updated_at = "today";
    }],
  ])("rejects malformed Project data: %s", async (_label, mutate) => {
    const data = validResponse();
    mutate(data);
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getDashboardReadModel()).resolves.toMatchObject({ ok: false });
  });

  it.each([
    ["number", (value: ReturnType<typeof validResponse>) => {
      value.work_orders.recent[0]!.work_order_number = "WO-1";
    }],
    ["status", (value: ReturnType<typeof validResponse>) => {
      value.work_orders.recent[0]!.status = "closed";
    }],
    ["UUID", (value: ReturnType<typeof validResponse>) => {
      value.work_orders.recent[0]!.id = "bad";
    }],
    ["timestamp", (value: ReturnType<typeof validResponse>) => {
      value.work_orders.recent[0]!.created_at = "bad";
    }],
  ])("rejects malformed Work Order %s", async (_label, mutate) => {
    const data = validResponse();
    mutate(data);
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getDashboardReadModel()).resolves.toMatchObject({ ok: false });
  });

  it.each([
    ["later-section extra field", (value: ReturnType<typeof validResponse>) => {
      Object.assign(value.inventory.recent[0]!, { cost: "secret" });
    }],
    ["protected Activity field", (value: ReturnType<typeof validResponse>) => {
      Object.assign(value.activity.recent[0]!, { metadata: { hidden: true } });
    }],
    ["malformed exact quantity", (value: ReturnType<typeof validResponse>) => {
      value.procurement.unresolved[0]!.requested_quantity = "1e3";
    }],
    ["unknown Calendar kind", (value: ReturnType<typeof validResponse>) => {
      value.calendar.upcoming[0]!.kind = "holiday";
    }],
    ["invalid Calendar range", (value: ReturnType<typeof validResponse>) => {
      value.calendar.upcoming[0]!.end_date = "2026-10-09";
    }],
  ])("strictly rejects unsafe later-section data: %s", async (_label, mutate) => {
    const data = validResponse();
    mutate(data);
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getDashboardReadModel()).resolves.toMatchObject({ ok: false });
  });

  it("maps provider and thrown errors to the same safe message", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "raw SQL" } });
    await expect(getDashboardReadModel()).resolves.toMatchObject({
      ok: false,
      error: { code: "dashboard_load_failed" },
    });

    mocks.rpc.mockRejectedValueOnce(new Error("raw network detail"));
    await expect(getDashboardReadModel()).resolves.toEqual({
      ok: false,
      error: {
        code: "dashboard_load_failed",
        message: "The Dashboard overview could not be loaded.",
      },
    });
  });
});
