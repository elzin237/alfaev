import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { listProjectMaterialUsage } from "./projectMaterialUsageService";

const projectId = "00000000-0000-4000-8000-000000000001";
const row = {
  movement_id: "00000000-0000-4000-8000-000000000002",
  project_id: projectId,
  product_id: "00000000-0000-4000-8000-000000000003",
  serial_number: "0000042",
  product_name: "Archived Control Module",
  quantity: "9007199254740993",
  source_type: "work_order",
  source_id: "00000000-0000-4000-8000-000000000004",
  source_label: "RN-2026-0041",
  consumed_at: "2026-09-30T12:34:56.123456+00:00",
};

beforeEach(() => vi.resetAllMocks());

describe("projectMaterialUsageService", () => {
  it("calls the narrow RPC and preserves exact quantity text and backend ordering", async () => {
    mocks.rpc.mockResolvedValue({
      data: [row, {
        ...row,
        movement_id: "00000000-0000-4000-8000-000000000005",
        quantity: "9223372036854775807",
        consumed_at: "2026-09-29T12:34:56Z",
      }],
      error: null,
    });

    await expect(listProjectMaterialUsage(projectId)).resolves.toEqual({
      ok: true,
      value: [
        {
          movementId: row.movement_id,
          projectId,
          productId: row.product_id,
          serialNumber: "0000042",
          productName: "Archived Control Module",
          quantity: "9007199254740993",
          sourceType: "work_order",
          sourceId: row.source_id,
          sourceLabel: "RN-2026-0041",
          consumedAt: row.consumed_at,
        },
        expect.objectContaining({
          movementId: "00000000-0000-4000-8000-000000000005",
          quantity: "9223372036854775807",
        }),
      ],
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_project_material_usage",
      { p_project_id: projectId },
    );
  });

  it("supports an empty usage history", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(listProjectMaterialUsage(projectId)).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it.each([
    ["cross-Project row", { ...row, project_id: "00000000-0000-4000-8000-000000000099" }],
    ["unsafe numeric quantity", { ...row, quantity: 5 }],
    ["zero quantity", { ...row, quantity: "0" }],
    ["overflow quantity", { ...row, quantity: "9223372036854775808" }],
    ["malformed Work Order", { ...row, source_label: "WO-41" }],
    ["unknown source type", { ...row, source_type: "manual_adjustment" }],
    ["blank PCB label", { ...row, source_type: "pcb_production", source_label: " " }],
    ["extra field", { ...row, internal_actor: "secret" }],
  ])("fails safely for a malformed %s", async (_label, malformed) => {
    mocks.rpc.mockResolvedValue({ data: [malformed], error: null });
    await expect(listProjectMaterialUsage(projectId)).resolves.toEqual({
      ok: false,
      error: {
        code: "project_usage_load_failed",
        message: "Project material usage could not be loaded. Please try again.",
      },
    });
  });

  it("maps provider errors safely and never exposes raw details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "raw policy details" },
    });
    await expect(listProjectMaterialUsage(projectId)).resolves.toEqual({
      ok: false,
      error: {
        code: "access_denied",
        message: "You no longer have permission to view this Project's material usage.",
      },
    });

    mocks.rpc.mockRejectedValueOnce(new Error("raw transport details"));
    await expect(listProjectMaterialUsage(projectId)).resolves.toEqual({
      ok: false,
      error: {
        code: "project_usage_load_failed",
        message: "Project material usage could not be loaded. Please try again.",
      },
    });
  });

  it("rejects an invalid Project ID without querying the backend", async () => {
    await expect(listProjectMaterialUsage("not-a-project")).resolves
      .toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps Project-linked PCB Production with exact source identity", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        ...row,
        source_type: "pcb_production",
        source_id: "00000000-0000-4000-8000-000000000006",
        source_label: "Controller PCB A",
      }],
      error: null,
    });
    await expect(listProjectMaterialUsage(projectId)).resolves.toMatchObject({
      ok: true,
      value: [{
        sourceType: "pcb_production",
        sourceId: "00000000-0000-4000-8000-000000000006",
        sourceLabel: "Controller PCB A",
      }],
    });
  });
});
