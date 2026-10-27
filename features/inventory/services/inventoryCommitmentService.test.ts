import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));

import { getFinishedGoodsInventoryCommitments, getInventoryCommitments, getProductProjectCommitments } from "./inventoryCommitmentService";

const productId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => vi.resetAllMocks());

describe("inventory commitment reads", () => {
  it("reads warehouse-only FG aggregates with SQL text projection before JSON", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ product_id: productId,
      physical_quantity: "9223372036854775807", committed_to_projects: "9007199254740993",
      available_after_commitments: "9214364837600034814" }], error: null });
    mocks.rpc.mockReturnValue({ select });
    expect(await getFinishedGoodsInventoryCommitments()).toEqual({ ok: true, value: [{ productId,
      physicalQuantity: 9223372036854775807n, committedToProjects: 9007199254740993n,
      availableAfterCommitments: 9214364837600034814n }] });
    expect(mocks.rpc).toHaveBeenCalledWith("get_finished_goods_inventory_commitments");
    expect(select).toHaveBeenCalledWith("product_id,physical_quantity::text,committed_to_projects::text,available_after_commitments::text");
  });
  it.each([
    { physical_quantity: 2 }, { project_id: projectId }, { committed_to_projects: "3", available_after_commitments: "-1" },
    { physical_quantity: "9223372036854775808", available_after_commitments: "9223372036854775808" },
    { available_after_commitments: "1" },
  ])("fails closed on malformed/leaking FG aggregates %j", async invalid => {
    mocks.rpc.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ product_id: productId,
      physical_quantity: "2", committed_to_projects: "0", available_after_commitments: "2", ...invalid }], error: null }) });
    expect(await getFinishedGoodsInventoryCommitments()).toMatchObject({ ok: false });
  });
  it("reads trusted totals and preserves signed, large whole-number arithmetic", async () => {
    mocks.rpc.mockResolvedValue({ data: [{
      product_id: productId,
      physical_quantity: "9007199254740993",
      committed_to_projects: "9007199254740994",
      available_after_commitments: "-1",
    }], error: null });
    expect(await getInventoryCommitments()).toEqual({ ok: true, value: [{
      productId, physicalQuantity: 9007199254740993n,
      committedToProjects: 9007199254740994n,
      availableAfterCommitments: -1n,
    }] });
    expect(mocks.rpc).toHaveBeenCalledWith("get_inventory_project_commitments");
  });

  it.each([
    { physical_quantity: 1.5, committed_to_projects: 0, available_after_commitments: 1 },
    { physical_quantity: Number.MAX_SAFE_INTEGER + 1, committed_to_projects: 0, available_after_commitments: 0 },
    { physical_quantity: "5", committed_to_projects: "2", available_after_commitments: "4" },
    { physical_quantity: "5", committed_to_projects: "-2", available_after_commitments: "7" },
  ])("fails safely for malformed totals", async (row) => {
    mocks.rpc.mockResolvedValue({ data: [{ product_id: productId, ...row }], error: null });
    expect(await getInventoryCommitments()).toMatchObject({ ok: false, error: { code: "load_failed" } });
  });

  it("reads only one Product's trusted Project attribution on request", async () => {
    mocks.rpc.mockResolvedValue({ data: [{
      project_id: projectId, project_name: "Open Project", planned_requirement: "10",
      actual_project_consumption: "4", outstanding_commitment: "6",
    }], error: null });
    expect(await getProductProjectCommitments(productId)).toEqual({ ok: true, value: [{
      projectId, projectName: "Open Project", plannedRequirement: 10n,
      actualProjectConsumption: 4n, outstandingCommitment: 6n,
    }] });
    expect(mocks.rpc).toHaveBeenCalledWith("get_product_project_commitments", { p_product_id: productId });
  });

  it("hides provider failures and rejects malformed attribution", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "private SQL detail" } })
      .mockResolvedValueOnce({ data: [{ project_id: projectId, project_name: "Open Project", planned_requirement: 5, actual_project_consumption: 1, outstanding_commitment: 5 }], error: null });
    expect(await getInventoryCommitments()).toEqual({ ok: false, error: {
      code: "load_failed", message: "Project commitments could not be loaded. Please try again.",
    } });
    expect(await getProductProjectCommitments(productId)).toMatchObject({ ok: false, error: { code: "load_failed" } });
  });
});
