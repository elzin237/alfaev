import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: serviceMocks.rpc },
}));

import {
  getFinishedWorkOrderDetail,
  listFinishedWorkOrderMaterials,
  listFinishedWorkOrderMovements,
} from "./finishedWorkOrderService";

const workOrderId = "00000000-0000-4000-8000-000000000010";
const projectId = "00000000-0000-4000-8000-000000000020";
const actorId = "00000000-0000-4000-8000-000000000021";
const productId = "00000000-0000-4000-8000-000000000030";
const movementId = "00000000-0000-4000-8000-000000000040";
const pdfId = "00000000-0000-4000-8000-000000000050";

const detailRow = {
  work_order_id: workOrderId,
  work_order_number: "RN-2026-0042",
  project_id: projectId,
  project_name: "Alpha Project",
  customer_name_snapshot: "Alpha Customer",
  description: "Build controller enclosure",
  created_at: "2026-09-22T09:00:00.123456+00:00",
  finished_at: "2026-09-22T10:00:00.654321+00:00",
  finished_by_user_id: actorId,
  finished_by_full_name: "Ada Lovelace",
  pdf_id: pdfId,
  document_version: 1,
  generated_at: "2026-09-22T10:00:00.654321+00:00",
};

const materialRow = {
  product_id: productId,
  serial_number: "0000123",
  product_name: "Archived Relay Module",
  quantity: "9223372036854775807",
};

const movementRow = {
  movement_id: movementId,
  product_id: productId,
  serial_number: "0000123",
  product_name: "Archived Relay Module",
  quantity_delta: "-9223372036854775807",
  quantity_before: "9223372036854775807",
  quantity_after: "0",
  created_at: "2026-09-22T10:00:00.654321+00:00",
};

beforeEach(() => vi.resetAllMocks());

describe("finishedWorkOrderService", () => {
  it("maps the exact trusted detail projection including narrow actor and PDF metadata", async () => {
    serviceMocks.rpc.mockResolvedValue({ data: [detailRow], error: null });

    await expect(getFinishedWorkOrderDetail(workOrderId)).resolves.toEqual({
      ok: true,
      value: {
        id: workOrderId,
        workOrderNumber: "RN-2026-0042",
        projectId,
        projectName: "Alpha Project",
        customerName: "Alpha Customer",
        description: "Build controller enclosure",
        createdAt: detailRow.created_at,
        finishedAt: detailRow.finished_at,
        finishedByUserId: actorId,
        finishedByFullName: "Ada Lovelace",
        pdf: {
          id: pdfId,
          documentVersion: 1,
          generatedAt: detailRow.generated_at,
        },
      },
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "get_finished_work_order_detail",
      { p_work_order_id: workOrderId },
    );
  });

  it("accepts absent PDF metadata only when the complete PDF triplet is null", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [{
        ...detailRow,
        pdf_id: null,
        document_version: null,
        generated_at: null,
      }],
      error: null,
    });
    await expect(getFinishedWorkOrderDetail(workOrderId)).resolves
      .toMatchObject({ ok: true, value: { pdf: null } });

    serviceMocks.rpc.mockResolvedValue({
      data: [{ ...detailRow, generated_at: null }],
      error: null,
    });
    await expect(getFinishedWorkOrderDetail(workOrderId)).resolves
      .toMatchObject({
        ok: false,
        error: { code: "finished_work_order_read_failed" },
      });
  });

  it("preserves exact bigint material quantities and backend ordering", async () => {
    serviceMocks.rpc.mockResolvedValue({
      data: [materialRow, {
        ...materialRow,
        product_id: "00000000-0000-4000-8000-000000000031",
        serial_number: "0000124",
        quantity: "1",
      }],
      error: null,
    });

    await expect(listFinishedWorkOrderMaterials(workOrderId)).resolves.toEqual({
      ok: true,
      value: [{
        productId,
        serialNumber: "0000123",
        productName: "Archived Relay Module",
        quantity: "9223372036854775807",
      }, {
        productId: "00000000-0000-4000-8000-000000000031",
        serialNumber: "0000124",
        productName: "Archived Relay Module",
        quantity: "1",
      }],
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_finished_work_order_materials",
      { p_work_order_id: workOrderId },
    );
  });

  it("preserves exact signed movement quantities and validates ledger arithmetic", async () => {
    serviceMocks.rpc.mockResolvedValue({ data: [movementRow], error: null });

    await expect(listFinishedWorkOrderMovements(workOrderId)).resolves.toEqual({
      ok: true,
      value: [{
        movementId,
        productId,
        serialNumber: "0000123",
        productName: "Archived Relay Module",
        quantityDelta: "-9223372036854775807",
        quantityBefore: "9223372036854775807",
        quantityAfter: "0",
        createdAt: movementRow.created_at,
      }],
    });
    expect(serviceMocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_finished_work_order_movements",
      { p_work_order_id: workOrderId },
    );

    serviceMocks.rpc.mockResolvedValue({
      data: [{ ...movementRow, quantity_after: "1" }],
      error: null,
    });
    await expect(listFinishedWorkOrderMovements(workOrderId)).resolves
      .toMatchObject({
        ok: false,
        error: { code: "finished_work_order_read_failed" },
      });
  });

  it.each([
    ["unexpected actor email", { ...detailRow, actor_email: "hidden@example.test" }],
    ["numeric material quantity", { ...materialRow, quantity: 1 }],
    ["zero material quantity", { ...materialRow, quantity: "0" }],
    ["overflow material quantity", {
      ...materialRow,
      quantity: "9223372036854775808",
    }],
  ])("fails safely for %s", async (_label, row) => {
    const isDetail = "work_order_id" in row;
    serviceMocks.rpc.mockResolvedValue({ data: [row], error: null });
    const result = isDetail
      ? await getFinishedWorkOrderDetail(workOrderId)
      : await listFinishedWorkOrderMaterials(workOrderId);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "finished_work_order_read_failed",
        message: "The Finished Work Order could not be loaded. Please try again.",
      },
    });
  });

  it.each([
    ["42501", "access_denied"],
    ["P0002", "work_order_not_found"],
    ["WOR10", "work_order_not_finished"],
    ["22023", "invalid_request"],
    ["XX000", "finished_work_order_read_failed"],
  ])("maps backend %s without exposing raw provider text", async (backendCode, expectedCode) => {
    serviceMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: backendCode, message: "sensitive raw database text" },
    });
    const result = await getFinishedWorkOrderDetail(workOrderId);
    expect(result).toMatchObject({ ok: false, error: { code: expectedCode } });
    expect(JSON.stringify(result)).not.toContain("sensitive raw database text");
  });

  it("fails safely for thrown providers and empty or malformed responses", async () => {
    serviceMocks.rpc.mockRejectedValueOnce(new Error("raw transport failure"));
    await expect(listFinishedWorkOrderMaterials(workOrderId)).resolves
      .toMatchObject({
        ok: false,
        error: { code: "finished_work_order_read_failed" },
      });

    serviceMocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(getFinishedWorkOrderDetail(workOrderId)).resolves
      .toMatchObject({
        ok: false,
        error: { code: "finished_work_order_read_failed" },
      });
  });
});
