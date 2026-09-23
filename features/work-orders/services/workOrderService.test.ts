import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: serviceMocks.rpc },
}));

import {
  createDraftWorkOrder,
  getWorkOrderDetail,
  listWorkOrderProjectChoices,
  listWorkOrders,
} from "./workOrderService";

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

const detailRow = {
  ...populatedRow,
  description: "Build controller enclosure",
  updated_at: "2026-09-22T11:30:00.000Z",
};

const incompleteDetailRow = {
  ...incompleteRow,
  description: null,
  updated_at: "2026-09-22T09:00:00+00:00",
};

const projectChoices = [
  {
    project_id: "00000000-0000-4000-8000-000000000021",
    name: "alpha Project",
    customer_name: "Alpha Customer",
    status: "planned",
  },
  {
    project_id: "00000000-0000-4000-8000-000000000022",
    name: "Bravo Project",
    customer_name: "Bravo Customer",
    status: "on_hold",
  },
] as const;

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

  it("reads and maps incomplete, populated, and Finished Work Order details", async () => {
    serviceMocks.rpc
      .mockResolvedValueOnce({ data: [incompleteDetailRow], error: null })
      .mockResolvedValueOnce({ data: [{ ...detailRow, status: "draft" }], error: null })
      .mockResolvedValueOnce({ data: [detailRow], error: null });

    await expect(getWorkOrderDetail(incompleteDetailRow.work_order_id))
      .resolves.toEqual({
        ok: true,
        value: {
          id: incompleteDetailRow.work_order_id,
          workOrderNumber: "RN-2026-0001",
          status: "draft",
          projectId: null,
          projectName: null,
          customerName: null,
          description: null,
          createdAt: incompleteDetailRow.created_at,
          updatedAt: incompleteDetailRow.updated_at,
        },
      });
    await expect(getWorkOrderDetail(detailRow.work_order_id)).resolves
      .toMatchObject({ ok: true, value: { status: "draft" } });
    await expect(getWorkOrderDetail(detailRow.work_order_id)).resolves
      .toMatchObject({
        ok: true,
        value: {
          id: detailRow.work_order_id,
          status: "finished",
          projectName: "Alpha Project",
          description: "Build controller enclosure",
        },
      });
    expect(serviceMocks.rpc).toHaveBeenNthCalledWith(
      1,
      "get_work_order_detail",
      { p_work_order_id: incompleteDetailRow.work_order_id },
    );
  });

  it("maps a missing Work Order and access loss to safe detail errors", async () => {
    serviceMocks.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42501", message: "raw database permission details" },
      });

    await expect(getWorkOrderDetail(detailRow.work_order_id)).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_not_found",
        message: "The Work Order could not be found.",
      },
    });
    await expect(getWorkOrderDetail(detailRow.work_order_id)).resolves.toEqual({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have permission to view this Work Order.",
      },
    });
  });

  it.each([
    ["multiple rows", [detailRow, detailRow]],
    ["invalid UUID", [{ ...detailRow, work_order_id: "invalid" }]],
    ["invalid status", [{ ...detailRow, status: "cancelled" }]],
    ["invalid timestamp", [{ ...detailRow, updated_at: "yesterday" }]],
    ["inconsistent Project", [{ ...detailRow, project_name: null }]],
    ["unexpected field", [{ ...detailRow, hidden: "value" }]],
    ["missing field", [(() => {
      const { description: _description, ...row } = detailRow;
      return row;
    })()]],
  ])("rejects malformed Work Order detail with %s", async (_label, data) => {
    serviceMocks.rpc.mockResolvedValue({ data, error: null });

    await expect(getWorkOrderDetail(detailRow.work_order_id)).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_detail_failed",
        message: "The Work Order details could not be loaded.",
      },
    });
  });

  it("maps provider and thrown detail failures without exposing raw errors", async () => {
    serviceMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "raw provider detail" },
    });
    await expect(getWorkOrderDetail(detailRow.work_order_id)).resolves
      .toMatchObject({ ok: false, error: { code: "work_order_detail_failed" } });

    serviceMocks.rpc.mockRejectedValueOnce(new Error("raw network detail"));
    await expect(getWorkOrderDetail(detailRow.work_order_id)).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_detail_failed",
        message: "The Work Order details could not be loaded.",
      },
    });
  });

  it("reads Project choices through the trusted RPC and preserves backend order", async () => {
    serviceMocks.rpc.mockResolvedValue({ data: projectChoices, error: null });

    await expect(listWorkOrderProjectChoices()).resolves.toEqual({
      ok: true,
      value: [
        {
          id: projectChoices[0].project_id,
          name: "alpha Project",
          customerName: "Alpha Customer",
          status: "planned",
        },
        {
          id: projectChoices[1].project_id,
          name: "Bravo Project",
          customerName: "Bravo Customer",
          status: "on_hold",
        },
      ],
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_work_order_project_choices",
    );
  });

  it.each([
    ["closed status", [{ ...projectChoices[0], status: "completed" }]],
    ["invalid ID", [{ ...projectChoices[0], project_id: "invalid" }]],
    ["blank name", [{ ...projectChoices[0], name: " " }]],
    ["unexpected field", [{ ...projectChoices[0], start_date: "2026-01-01" }]],
  ])("rejects malformed Project choices with %s", async (_label, data) => {
    serviceMocks.rpc.mockResolvedValue({ data, error: null });
    await expect(listWorkOrderProjectChoices()).resolves.toMatchObject({
      ok: false,
      error: { code: "work_order_project_choices_failed" },
    });
  });

  it("maps Project-choice provider and thrown failures safely", async () => {
    serviceMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "raw permission detail" },
    });
    await expect(listWorkOrderProjectChoices()).resolves.toMatchObject({
      ok: false,
      error: { code: "access_denied" },
    });

    serviceMocks.rpc.mockRejectedValueOnce(new Error("raw network detail"));
    await expect(listWorkOrderProjectChoices()).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_project_choices_failed",
        message: "Project choices could not be loaded.",
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
