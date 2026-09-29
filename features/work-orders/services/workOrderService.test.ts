import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: serviceMocks.rpc },
}));

import {
  createDraftWorkOrder,
  deleteDraftWorkOrder,
  getWorkOrderMaterialInventory,
  getWorkOrderDetail,
  listDraftWorkOrderMaterials,
  listWorkOrderProjectChoices,
  listWorkOrders,
  resolveWorkOrderProductBarcode,
  saveDraftWorkOrder,
  updateDraftWorkOrder,
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

const resolvedProductRow = {
  product_id: "00000000-0000-4000-8000-000000000030",
  serial_number: "0000123",
  name: "Relay Module",
};

const materialInventoryRow = {
  product_id: resolvedProductRow.product_id,
  current_inventory: "9223372036854775807",
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

  it("sends the exact authoritative timestamp and maps one strict Draft update result", async () => {
    const exactTimestamp = "2026-09-22T10:00:00.123456+00:00";
    serviceMocks.rpc.mockResolvedValue({
      data: [{
        work_order_id: detailRow.work_order_id,
        updated_at: "2026-09-22T10:01:00.654321+00:00",
      }],
      error: null,
    });

    await expect(updateDraftWorkOrder(detailRow.work_order_id, {
      projectId: projectChoices[1].project_id,
      description: "  Keep backend normalization authoritative  ",
      expectedUpdatedAt: exactTimestamp,
    })).resolves.toEqual({
      ok: true,
      value: {
        workOrderId: detailRow.work_order_id,
        updatedAt: "2026-09-22T10:01:00.654321+00:00",
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "update_draft_work_order",
      {
        p_work_order_id: detailRow.work_order_id,
        p_project_id: projectChoices[1].project_id,
        p_description: "  Keep backend normalization authoritative  ",
        p_expected_updated_at: exactTimestamp,
      },
    );
    expect(serviceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "p_customer_name_snapshot",
    );
  });

  it.each([
    ["empty result", []],
    ["multiple results", [
      { work_order_id: detailRow.work_order_id, updated_at: detailRow.updated_at },
      { work_order_id: detailRow.work_order_id, updated_at: detailRow.updated_at },
    ]],
    ["different Work Order", [{
      work_order_id: incompleteDetailRow.work_order_id,
      updated_at: detailRow.updated_at,
    }]],
    ["invalid timestamp", [{
      work_order_id: detailRow.work_order_id,
      updated_at: "not-a-timestamp",
    }]],
    ["missing field", [{ work_order_id: detailRow.work_order_id }]],
    ["unexpected field", [{
      work_order_id: detailRow.work_order_id,
      updated_at: detailRow.updated_at,
      customer_name_snapshot: "Must not be exposed",
    }]],
  ])("rejects a malformed Draft update response with %s", async (_label, data) => {
    serviceMocks.rpc.mockResolvedValue({ data, error: null });

    await expect(updateDraftWorkOrder(detailRow.work_order_id, {
      projectId: null,
      description: null,
      expectedUpdatedAt: detailRow.updated_at,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_update_failed",
        message: "The Draft could not be saved. Please try again.",
      },
    });
  });

  it.each([
    ["42501", "access_denied", "You no longer have permission to edit this Draft."],
    ["WOR02", "work_order_not_editable", "This Work Order can no longer be edited."],
    [
      "WOR05",
      "stale_work_order",
      "This Draft changed since you loaded it. Reload the latest version before saving.",
    ],
    ["XX000", "work_order_update_failed", "The Draft could not be saved. Please try again."],
  ])("maps %s to a safe Draft update error", async (providerCode, code, message) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw database detail" },
    });

    await expect(updateDraftWorkOrder(detailRow.work_order_id, {
      projectId: null,
      description: null,
      expectedUpdatedAt: detailRow.updated_at,
    })).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("maps thrown Draft update failures without exposing raw details", async () => {
    serviceMocks.rpc.mockRejectedValue(new Error("raw network detail"));

    await expect(updateDraftWorkOrder(detailRow.work_order_id, {
      projectId: null,
      description: null,
      expectedUpdatedAt: detailRow.updated_at,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "work_order_update_failed",
        message: "The Draft could not be saved. Please try again.",
      },
    });
  });

  it("resolves a Product through the exact trusted RPC and preserves leading zeroes", async () => {
    serviceMocks.rpc.mockResolvedValue({ data: [resolvedProductRow], error: null });

    await expect(resolveWorkOrderProductBarcode(
      detailRow.work_order_id,
      "0000123",
    )).resolves.toEqual({
      ok: true,
      value: {
        id: resolvedProductRow.product_id,
        serialNumber: "0000123",
        name: "Relay Module",
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "resolve_work_order_product_barcode",
      {
        p_work_order_id: detailRow.work_order_id,
        p_serial_number: "0000123",
      },
    );
  });

  it.each([
    ["mismatched serial", { ...resolvedProductRow, serial_number: "0000124" }],
    ["invalid UUID", { ...resolvedProductRow, product_id: "invalid" }],
    ["invalid serial", { ...resolvedProductRow, serial_number: "123" }],
    ["blank name", { ...resolvedProductRow, name: "" }],
    ["untrimmed name", { ...resolvedProductRow, name: " Relay Module " }],
    ["missing field", (() => {
      const { name: _name, ...row } = resolvedProductRow;
      return row;
    })()],
    ["extra field", { ...resolvedProductRow, product_kind: "component" }],
  ])("rejects a malformed resolved Product with %s", async (_label, row) => {
    serviceMocks.rpc.mockResolvedValue({ data: [row], error: null });

    await expect(resolveWorkOrderProductBarcode(
      detailRow.work_order_id,
      "0000123",
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "product_resolution_failed",
        message: "The Product could not be resolved. Please try again.",
      },
    });
  });

  it.each([
    ["42501", "access_denied", "You no longer have permission to edit this Draft."],
    ["WOR02", "work_order_not_editable", "This Work Order can no longer be edited."],
    ["22023", "invalid_serial_number", "Enter a valid 7-digit Serial Number."],
    ["P0002", "product_not_found", "No Product was found for this Serial Number."],
    [
      "PRD05",
      "product_unavailable",
      "This Product is archived or unavailable for this Work Order.",
    ],
    [
      "XX000",
      "product_resolution_failed",
      "The Product could not be resolved. Please try again.",
    ],
  ])("maps resolver error %s safely", async (providerCode, code, message) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw backend details" },
    });

    await expect(resolveWorkOrderProductBarcode(
      detailRow.work_order_id,
      "0000123",
    )).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("maps malformed cardinality and thrown resolver failures safely", async () => {
    serviceMocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveWorkOrderProductBarcode(
      detailRow.work_order_id,
      "0000123",
    )).resolves.toMatchObject({
      ok: false,
      error: { code: "product_resolution_failed" },
    });

    serviceMocks.rpc.mockRejectedValueOnce(new Error("raw network details"));
    await expect(resolveWorkOrderProductBarcode(
      detailRow.work_order_id,
      "0000123",
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "product_resolution_failed",
        message: "The Product could not be resolved. Please try again.",
      },
    });
  });

  it("reads exact material Inventory through the trusted RPC without Number coercion", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [materialInventoryRow],
      error: null,
    });

    await expect(getWorkOrderMaterialInventory(
      detailRow.work_order_id,
      resolvedProductRow.product_id,
    )).resolves.toEqual({
      ok: true,
      value: {
        productId: resolvedProductRow.product_id,
        currentInventory: "9223372036854775807",
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_work_order_material_inventory",
      {
        p_work_order_id: detailRow.work_order_id,
        p_product_id: resolvedProductRow.product_id,
      },
    );
    expect(serviceMocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "p_inventory_view",
    );
  });

  it("normalizes only a safe numeric Inventory response to exact decimal text", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [{ ...materialInventoryRow, current_inventory: 0 }],
      error: null,
    });

    await expect(getWorkOrderMaterialInventory(
      detailRow.work_order_id,
      resolvedProductRow.product_id,
    )).resolves.toMatchObject({
      ok: true,
      value: { currentInventory: "0" },
    });
  });

  it.each([
    ["different Product", { ...materialInventoryRow, product_id: detailRow.work_order_id }],
    ["invalid UUID", { ...materialInventoryRow, product_id: "invalid" }],
    ["missing field", { product_id: materialInventoryRow.product_id }],
    ["extra field", { ...materialInventoryRow, product_name: "Hidden" }],
    ["unsafe number", { ...materialInventoryRow, current_inventory: 9007199254740992 }],
    ["negative", { ...materialInventoryRow, current_inventory: "-1" }],
    ["decimal", { ...materialInventoryRow, current_inventory: "1.5" }],
    ["leading zero", { ...materialInventoryRow, current_inventory: "01" }],
    ["overflow", { ...materialInventoryRow, current_inventory: "9223372036854775808" }],
    ["missing row", null],
  ])("rejects malformed material Inventory with %s", async (_label, row) => {
    serviceMocks.rpc.mockResolvedValue({
      data: row === null ? [] : [row],
      error: null,
    });

    await expect(getWorkOrderMaterialInventory(
      detailRow.work_order_id,
      resolvedProductRow.product_id,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "material_inventory_failed",
        message: "Current Inventory could not be loaded. Please try again.",
      },
    });
  });

  it.each([
    ["42501", "access_denied", "You no longer have permission to edit this Draft."],
    ["WOR02", "work_order_not_editable", "This Work Order can no longer be edited."],
    [
      "PRD05",
      "product_unavailable",
      "This Product is archived or unavailable for this Work Order.",
    ],
    [
      "IVB01",
      "inventory_unavailable",
      "Current Inventory could not be loaded for this Product.",
    ],
    ["22023", "invalid_request", "The material Inventory request is invalid."],
    ["P0002", "material_not_found", "The Work Order or Product could not be found."],
    [
      "XX000",
      "material_inventory_failed",
      "Current Inventory could not be loaded. Please try again.",
    ],
  ])("maps material Inventory error %s safely", async (
    providerCode,
    code,
    message,
  ) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw backend details" },
    });

    await expect(getWorkOrderMaterialInventory(
      detailRow.work_order_id,
      resolvedProductRow.product_id,
    )).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("maps thrown material Inventory failures without exposing raw details", async () => {
    serviceMocks.rpc.mockRejectedValue(new Error("raw provider network details"));

    await expect(getWorkOrderMaterialInventory(
      detailRow.work_order_id,
      resolvedProductRow.product_id,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "material_inventory_failed",
        message: "Current Inventory could not be loaded. Please try again.",
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

  it("loads strict persisted Draft materials in server order with exact bigint text", async () => {
    const rows = [
      {
        product_id: "00000000-0000-4000-8000-000000000031",
        serial_number: "0000001",
        product_name: "First Product",
        quantity: "9223372036854775807",
        current_inventory: "0",
      },
      {
        product_id: "00000000-0000-4000-8000-000000000032",
        serial_number: "0000002",
        product_name: "Second Product",
        quantity: 2,
        current_inventory: "9223372036854775807",
      },
    ];
    serviceMocks.rpc.mockResolvedValue({ data: rows, error: null });

    await expect(listDraftWorkOrderMaterials(detailRow.work_order_id)).resolves
      .toEqual({
        ok: true,
        value: [
          {
            productId: rows[0]!.product_id,
            serialNumber: "0000001",
            productName: "First Product",
            quantity: "9223372036854775807",
            currentInventory: "0",
          },
          {
            productId: rows[1]!.product_id,
            serialNumber: "0000002",
            productName: "Second Product",
            quantity: "2",
            currentInventory: "9223372036854775807",
          },
        ],
      });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_draft_work_order_materials",
      { p_work_order_id: detailRow.work_order_id },
    );
  });

  it.each([
    ["duplicate", [
      { product_id: resolvedProductRow.product_id, serial_number: "0000001", product_name: "A", quantity: "1", current_inventory: "0" },
      { product_id: resolvedProductRow.product_id, serial_number: "0000002", product_name: "B", quantity: "2", current_inventory: "0" },
    ]],
    ["zero quantity", [{ product_id: resolvedProductRow.product_id, serial_number: "0000001", product_name: "A", quantity: "0", current_inventory: "0" }]],
    ["overflow quantity", [{ product_id: resolvedProductRow.product_id, serial_number: "0000001", product_name: "A", quantity: "9223372036854775808", current_inventory: "0" }]],
    ["unsafe numeric quantity", [{ product_id: resolvedProductRow.product_id, serial_number: "0000001", product_name: "A", quantity: 9007199254740992, current_inventory: "0" }]],
    ["invalid serial", [{ product_id: resolvedProductRow.product_id, serial_number: "123", product_name: "A", quantity: "1", current_inventory: "0" }]],
    ["untrimmed name", [{ product_id: resolvedProductRow.product_id, serial_number: "0000001", product_name: " A ", quantity: "1", current_inventory: "0" }]],
    ["extra field", [{ product_id: resolvedProductRow.product_id, serial_number: "0000001", product_name: "A", quantity: "1", current_inventory: "0", hidden: true }]],
  ])("rejects malformed persisted Draft materials with %s", async (_label, data) => {
    serviceMocks.rpc.mockResolvedValue({ data, error: null });
    await expect(listDraftWorkOrderMaterials(detailRow.work_order_id)).resolves
      .toMatchObject({ ok: false, error: { code: "draft_materials_load_failed" } });
  });

  it.each([
    ["42501", "access_denied"],
    ["WOR02", "work_order_not_draft"],
    ["P0002", "work_order_not_found"],
    ["IVB01", "inventory_unavailable"],
    ["XX000", "draft_materials_load_failed"],
  ])("maps persisted-material error %s safely", async (providerCode, code) => {
    serviceMocks.rpc.mockResolvedValue({ data: null, error: { code: providerCode, message: "raw detail" } });
    const result = await listDraftWorkOrderMaterials(detailRow.work_order_id);
    expect(result).toMatchObject({ ok: false, error: { code } });
    if (!result.ok) expect(result.error.message).not.toContain("raw detail");
  });

  it("atomically saves the exact desired material set and preserves timestamp precision", async () => {
    const returnedTimestamp = "2026-09-22T12:34:56.123456+00:00";
    serviceMocks.rpc.mockResolvedValue({
      data: [{ work_order_id: detailRow.work_order_id, updated_at: returnedTimestamp }],
      error: null,
    });
    await expect(saveDraftWorkOrder(detailRow.work_order_id, {
      projectId: null,
      description: " Draft ",
      expectedUpdatedAt: "2026-09-22T11:11:11.654321+00:00",
      items: [
        { productId: "00000000-0000-4000-8000-000000000032", quantity: "9223372036854775807" },
        { productId: "00000000-0000-4000-8000-000000000031", quantity: "1" },
      ],
    })).resolves.toEqual({ ok: true, value: { workOrderId: detailRow.work_order_id, updatedAt: returnedTimestamp } });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith("save_draft_work_order", {
      p_work_order_id: detailRow.work_order_id,
      p_project_id: null,
      p_description: " Draft ",
      p_items: [
        { product_id: "00000000-0000-4000-8000-000000000031", quantity: "1" },
        { product_id: "00000000-0000-4000-8000-000000000032", quantity: "9223372036854775807" },
      ],
      p_expected_updated_at: "2026-09-22T11:11:11.654321+00:00",
    });
  });

  it.each([
    ["42501", "access_denied"],
    ["WOR02", "work_order_not_editable"],
    ["WOR05", "stale_work_order"],
    ["PRD05", "product_unavailable"],
    ["22023", "invalid_draft"],
    ["P0002", "draft_reference_not_found"],
    ["XX000", "draft_save_failed"],
  ])("maps atomic save error %s safely", async (providerCode, code) => {
    serviceMocks.rpc.mockResolvedValue({ data: null, error: { code: providerCode, message: "raw detail" } });
    const result = await saveDraftWorkOrder(detailRow.work_order_id, {
      projectId: null,
      description: "",
      items: [],
      expectedUpdatedAt: detailRow.updated_at,
    });
    expect(result).toMatchObject({ ok: false, error: { code } });
    if (!result.ok) expect(result.error.message).not.toContain("raw detail");
  });

  it("deletes through the trusted RPC with the exact microsecond timestamp", async () => {
    const expectedUpdatedAt = "2026-09-22T12:34:56.123456+00:00";
    serviceMocks.rpc.mockResolvedValue({
      data: [{
        work_order_id: detailRow.work_order_id,
        work_order_number: detailRow.work_order_number,
      }],
      error: null,
    });

    await expect(deleteDraftWorkOrder(
      detailRow.work_order_id,
      expectedUpdatedAt,
    )).resolves.toEqual({
      ok: true,
      value: {
        workOrderId: detailRow.work_order_id,
        workOrderNumber: detailRow.work_order_number,
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "delete_draft_work_order",
      {
        p_work_order_id: detailRow.work_order_id,
        p_expected_updated_at: expectedUpdatedAt,
      },
    );
  });

  it.each([
    ["empty result", []],
    ["multiple results", [
      { work_order_id: detailRow.work_order_id, work_order_number: detailRow.work_order_number },
      { work_order_id: incompleteRow.work_order_id, work_order_number: incompleteRow.work_order_number },
    ]],
    ["mismatched ID", [{ work_order_id: incompleteRow.work_order_id, work_order_number: detailRow.work_order_number }]],
    ["malformed UUID", [{ work_order_id: "bad-id", work_order_number: detailRow.work_order_number }]],
    ["malformed number", [{ work_order_id: detailRow.work_order_id, work_order_number: "RN-2026-42" }]],
    ["missing field", [{ work_order_id: detailRow.work_order_id }]],
    ["extra field", [{ work_order_id: detailRow.work_order_id, work_order_number: detailRow.work_order_number, status: "draft" }]],
  ])("rejects a malformed delete response with %s", async (_label, data) => {
    serviceMocks.rpc.mockResolvedValue({ data, error: null });
    await expect(deleteDraftWorkOrder(
      detailRow.work_order_id,
      detailRow.updated_at,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "draft_delete_failed",
        message: "The Draft could not be deleted. Please try again.",
      },
    });
  });

  it.each([
    ["42501", "delete_access_denied", "You no longer have permission to delete this Draft."],
    ["WOR02", "work_order_not_deletable", "This Work Order can no longer be deleted."],
    ["WOR05", "stale_work_order", "This Draft changed somewhere else. Reload the latest Draft before deleting it."],
    ["P0002", "work_order_not_found", "The Work Order could not be found."],
    ["22023", "invalid_delete_request", "The Draft deletion request is invalid."],
    ["XX000", "draft_delete_failed", "The Draft could not be deleted. Please try again."],
  ])("maps delete error %s safely", async (providerCode, code, message) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "raw database details" },
    });
    await expect(deleteDraftWorkOrder(
      detailRow.work_order_id,
      detailRow.updated_at,
    )).resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("maps thrown delete failures without exposing raw details", async () => {
    serviceMocks.rpc.mockRejectedValue(new Error("raw network details"));
    const result = await deleteDraftWorkOrder(
      detailRow.work_order_id,
      detailRow.updated_at,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "draft_delete_failed",
        message: "The Draft could not be deleted. Please try again.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("raw");
  });
});
