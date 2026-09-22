import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: serviceMocks.rpc },
}));

import { createDraftWorkOrder, listWorkOrders } from "./workOrderService";

const populatedRow = {
  work_order_id: "00000000-0000-4000-8000-000000000002",
  work_order_number: "RN-2026-0002",
  status: "finished",
  project_id: "00000000-0000-4000-8000-000000000020",
  project_name: "Alpha Project",
  customer_name_snapshot: "Alpha Customer",
  created_at: "2026-09-22T10:30:00.000Z",
};

const incompleteRow = {
  work_order_id: "00000000-0000-4000-8000-000000000001",
  work_order_number: "RN-2026-0001",
  status: "draft",
  project_id: null,
  project_name: null,
  customer_name_snapshot: null,
  created_at: "2026-09-22T09:00:00+00:00",
};

beforeEach(() => vi.resetAllMocks());

describe("workOrderService", () => {
  it("calls the trusted list RPC and maps populated and incomplete rows without reordering", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [populatedRow, incompleteRow],
      error: null,
    });

    await expect(listWorkOrders()).resolves.toEqual({
      ok: true,
      value: [
        {
          id: populatedRow.work_order_id,
          workOrderNumber: populatedRow.work_order_number,
          status: "finished",
          projectId: populatedRow.project_id,
          projectName: populatedRow.project_name,
          customerName: populatedRow.customer_name_snapshot,
          createdAt: populatedRow.created_at,
        },
        {
          id: incompleteRow.work_order_id,
          workOrderNumber: incompleteRow.work_order_number,
          status: "draft",
          projectId: null,
          projectName: null,
          customerName: null,
          createdAt: incompleteRow.created_at,
        },
      ],
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith("list_work_orders");
  });

  it.each([
    ["unknown status", { ...populatedRow, status: "cancelled" }],
    ["invalid UUID", { ...populatedRow, work_order_id: "not-a-uuid" }],
    ["invalid timestamp", { ...populatedRow, created_at: "not-a-date" }],
    ["invalid number", { ...populatedRow, work_order_number: "2026-2" }],
    ["untrimmed customer", { ...populatedRow, customer_name_snapshot: " Customer " }],
    ["mismatched Project", { ...populatedRow, project_name: null }],
    ["missing field", (() => {
      const { created_at: _createdAt, ...row } = populatedRow;
      return row;
    })()],
    ["unexpected field", { ...populatedRow, description: "hidden" }],
  ])("fails safely for a malformed row with %s", async (_label, row) => {
    serviceMocks.rpc.mockResolvedValue({ data: [row], error: null });

    await expect(listWorkOrders()).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_list_failed",
        message: "The Work Order list could not be loaded.",
      },
    });
  });

  it("maps provider and thrown failures without exposing raw details", async () => {
    serviceMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "raw postgres detail" },
    });
    await expect(listWorkOrders()).resolves.toMatchObject({
      ok: false,
      error: { code: "work_order_list_failed" },
    });

    serviceMocks.rpc.mockRejectedValueOnce(new Error("raw network detail"));
    await expect(listWorkOrders()).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_list_failed",
        message: "The Work Order list could not be loaded.",
      },
    });
  });

  it("calls the zero-argument creation RPC and maps exactly one generated Draft", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [{
        work_order_id: "00000000-0000-4000-8000-000000000010",
        work_order_number: "RN-2026-0042",
      }],
      error: null,
    });

    await expect(createDraftWorkOrder()).resolves.toEqual({
      ok: true,
      value: {
        workOrderId: "00000000-0000-4000-8000-000000000010",
        workOrderNumber: "RN-2026-0042",
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "create_draft_work_order",
    );
  });

  it.each([
    ["empty result", []],
    ["multiple results", [
      {
        work_order_id: "00000000-0000-4000-8000-000000000010",
        work_order_number: "RN-2026-0042",
      },
      {
        work_order_id: "00000000-0000-4000-8000-000000000011",
        work_order_number: "RN-2026-0043",
      },
    ]],
    ["invalid UUID", [{
      work_order_id: "not-a-uuid",
      work_order_number: "RN-2026-0042",
    }]],
    ["invalid number", [{
      work_order_id: "00000000-0000-4000-8000-000000000010",
      work_order_number: "RN-2026-42",
    }]],
    ["unexpected field", [{
      work_order_id: "00000000-0000-4000-8000-000000000010",
      work_order_number: "RN-2026-0042",
      status: "draft",
    }]],
  ])("rejects a malformed creation response with %s", async (_label, data) => {
    serviceMocks.rpc.mockResolvedValue({ data, error: null });

    await expect(createDraftWorkOrder()).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_create_failed",
        message: "The Work Order could not be created. Please try again.",
      },
    });
  });

  it("maps access loss and provider failures to safe creation errors", async () => {
    serviceMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "raw permission details" },
    });
    await expect(createDraftWorkOrder()).resolves.toEqual({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have permission to create Work Orders.",
      },
    });

    serviceMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "raw database details" },
    });
    await expect(createDraftWorkOrder()).resolves.toMatchObject({
      ok: false,
      error: { code: "work_order_create_failed" },
    });

    serviceMocks.rpc.mockRejectedValueOnce(new Error("raw network details"));
    await expect(createDraftWorkOrder()).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_create_failed",
        message: "The Work Order could not be created. Please try again.",
      },
    });
  });
});
