import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const finishMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("../../../lib/supabase/client", () => ({
  supabase: { functions: { invoke: finishMocks.invoke } },
}));

import { finishWorkOrder } from "./workOrderFinishService";

const workOrderId = "00000000-0000-4000-8000-000000000010";
const expectedUpdatedAt = "2026-09-30T09:15:00.123456+00:00";
const success = {
  workOrderId,
  workOrderNumber: "RN-2026-0042",
  finishedAt: "2026-09-30T09:16:00.654321+00:00",
  projectId: "00000000-0000-4000-8000-000000000020",
  projectCompleted: true,
  workOrderPdfId: "00000000-0000-4000-8000-000000000030",
  storageReference:
    `final/${workOrderId}/00000000-0000-4000-8000-000000000040.pdf`,
};

function edgeError(code: string, rawMessage = "raw backend detail") {
  return {
    context: new Response(JSON.stringify({ code, message: rawMessage }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  };
}

beforeEach(() => vi.resetAllMocks());

describe("finishWorkOrder", () => {
  it("sends only the exact saved identity/version and strictly maps success", async () => {
    finishMocks.invoke.mockResolvedValue({ data: success, error: null });

    await expect(finishWorkOrder({ workOrderId, expectedUpdatedAt }))
      .resolves.toEqual({ ok: true, value: success });
    expect(finishMocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "finish-work-order",
      { body: { workOrderId, expectedUpdatedAt } },
    );
  });

  it.each([
    ["missing field", (() => {
      const { storageReference: _storageReference, ...rest } = success;
      return rest;
    })()],
    ["extra field", { ...success, materials: [] }],
    ["wrong Work Order", {
      ...success,
      workOrderId: "00000000-0000-4000-8000-000000000011",
    }],
    ["invalid number", { ...success, workOrderNumber: "WO-42" }],
    ["invalid timestamp", { ...success, finishedAt: "today" }],
    ["invalid Project", { ...success, projectId: "invalid" }],
    ["invalid completion flag", { ...success, projectCompleted: "yes" }],
    ["invalid PDF ID", { ...success, workOrderPdfId: "invalid" }],
    ["wrong storage namespace", {
      ...success,
      storageReference:
        `final/00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000040.pdf`,
    }],
  ])("rejects malformed success with %s safely", async (_label, data) => {
    finishMocks.invoke.mockResolvedValue({ data, error: null });

    await expect(finishWorkOrder({ workOrderId, expectedUpdatedAt }))
      .resolves.toEqual({
        ok: false,
        error: {
          code: "finish_failed",
          message: "The Work Order could not be finished. Please try again.",
        },
      });
  });

  it.each([
    ["access_denied", "access_denied", "You no longer have permission to finish this Work Order."],
    ["stale_work_order", "stale_work_order", "This Draft changed since you loaded it. Reload the latest Draft before finishing."],
    ["work_order_already_finished", "work_order_already_finished", "This Work Order is already Finished. Its latest state is being loaded."],
    ["insufficient_inventory", "insufficient_inventory", "Current physical Inventory is insufficient to finish this Work Order."],
    ["project_requirement_exceeded", "project_requirement_exceeded", "These materials exceed the remaining requirement for the selected Project. Reduce the quantities or review the Project plan."],
    ["project_unavailable", "project_unavailable", "The selected Project is no longer available for this Work Order."],
    ["product_unavailable", "product_unavailable", "A Work Order material Product is archived or unavailable."],
    ["inventory_balance_unavailable", "inventory_balance_unavailable", "Current Inventory is unavailable for a Work Order material."],
    ["work_order_incomplete", "work_order_incomplete", "Complete the Work Order before finishing it."],
    ["pdf_generation_failed", "pdf_finalization_failed", "The official Work Order PDF could not be finalized. Please try again."],
    ["storage_preparation_failed", "pdf_finalization_failed", "The official Work Order PDF could not be finalized. Please try again."],
    ["pdf_candidate_invalid", "pdf_finalization_failed", "The official Work Order PDF could not be finalized. Please try again."],
    ["finish_outcome_unknown", "finish_outcome_unknown", "The finalization result could not be confirmed. Reload the Work Order before trying again."],
    ["finish_response_invalid", "finish_response_invalid", "The Work Order was finalized, but its latest state could not be confirmed."],
  ])("maps %s without exposing raw details", async (backendCode, code, message) => {
    finishMocks.invoke.mockResolvedValue({
      data: null,
      error: edgeError(backendCode),
    });

    await expect(finishWorkOrder({ workOrderId, expectedUpdatedAt }))
      .resolves.toEqual({ ok: false, error: { code, message } });
  });

  it("uses a generic safe failure for unreadable and thrown provider errors", async () => {
    finishMocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "raw Supabase error" },
    });
    await expect(finishWorkOrder({ workOrderId, expectedUpdatedAt }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: "finish_failed" },
      });

    finishMocks.invoke.mockRejectedValueOnce(new Error("raw network failure"));
    await expect(finishWorkOrder({ workOrderId, expectedUpdatedAt }))
      .resolves.toMatchObject({
        ok: false,
        error: { code: "finish_failed" },
      });
  });

  it("rejects invalid client input before invoking the Edge Function", async () => {
    await expect(finishWorkOrder({
      workOrderId: "invalid",
      expectedUpdatedAt,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(finishMocks.invoke).not.toHaveBeenCalled();
  });

  it("uses only the Edge boundary with no direct RPC, Storage, or PDF access", () => {
    const source = readFileSync(
      "features/work-orders/services/workOrderFinishService.ts",
      "utf8",
    );

    expect(source).toContain('supabase.functions.invoke(\n      "finish-work-order"');
    expect(source).not.toMatch(/\.rpc\s*\(/);
    expect(source).not.toMatch(/\.storage\b|createSignedUrl|window\.open|download/i);
    expect(source).not.toContain("finish_work_order");
  });
});
