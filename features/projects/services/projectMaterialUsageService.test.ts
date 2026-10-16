import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { listProjectMaterialUsage } from "./projectMaterialUsageService";

const projectId = "00000000-0000-4000-8000-000000000001";
const row = {
  product_id: "00000000-0000-4000-8000-000000000003",
  serial_number: "0000042",
  product_name: "Archived Control Module",
  quantity: "18446744073709551614",
};

beforeEach(() => vi.resetAllMocks());

describe("projectMaterialUsageService", () => {
  it("calls the narrow RPC and preserves aggregate quantity text and backend ordering", async () => {
    mocks.rpc.mockResolvedValue({
      data: [row, {
        ...row,
        product_id: "00000000-0000-4000-8000-000000000005",
        serial_number: "0000043",
        quantity: "9223372036854775807",
      }],
      error: null,
    });

    await expect(listProjectMaterialUsage(projectId)).resolves.toEqual({
      ok: true,
      value: [
        {
          productId: row.product_id,
          serialNumber: "0000042",
          productName: "Archived Control Module",
          quantity: "18446744073709551614",
        },
        expect.objectContaining({
          productId: "00000000-0000-4000-8000-000000000005",
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
    ["unsafe numeric quantity", { ...row, quantity: 5 }],
    ["zero quantity", { ...row, quantity: "0" }],
    ["negative quantity", { ...row, quantity: "-1" }],
    ["malformed Product ID", { ...row, product_id: "not-a-product" }],
    ["malformed serial", { ...row, serial_number: "42" }],
    ["blank Product name", { ...row, product_name: " " }],
    ["legacy source field", { ...row, source_type: "work_order" }],
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
});
