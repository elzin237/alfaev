import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../lib/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));

import {
  createProjectProduct,
  createProjectRequirement,
  getProjectPlanning,
  removeProjectProduct,
  searchPlanningProductChoices,
  updateProjectRequirement,
} from "./projectPlanningService";

const projectId = "00000000-0000-4000-8000-000000000001";
const groupId = "00000000-0000-4000-8000-000000000002";
const emptyGroupId = "00000000-0000-4000-8000-000000000003";
const componentId = "00000000-0000-4000-8000-000000000004";
const productId = "00000000-0000-4000-8000-000000000005";

beforeEach(() => vi.resetAllMocks());

describe("projectPlanningService", () => {
  it("maps one trusted read including an empty group and historical Product identity", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          project_product_id: emptyGroupId,
          project_product_name: "Empty Group",
          component_id: null,
          product_id: null,
          serial_number: null,
          product_name: null,
          product_kind: null,
          required_quantity: null,
          category: null,
          brand_name: null,
          physical_quantity: null,
          committed_to_projects: null,
          available_after_commitments: null,
        },
        {
          project_product_id: groupId,
          project_product_name: "B24",
          component_id: componentId,
          product_id: productId,
          serial_number: "0000123",
          product_name: "Historical PCB",
          product_kind: "pcb_finished_good",
          required_quantity: "50",
          category: "Finished Goods",
          brand_name: "AlfaEV",
          physical_quantity: "9007199254740993",
          committed_to_projects: "9007199254740999",
          available_after_commitments: "-6",
        },
      ],
      error: null,
    });
    await expect(getProjectPlanning(projectId)).resolves.toEqual({
      ok: true,
      value: [
        { id: emptyGroupId, projectId, name: "Empty Group", requirements: [] },
        {
          id: groupId,
          projectId,
          name: "B24",
          requirements: [{
            id: componentId,
            productId,
            serialNumber: "0000123",
            productName: "Historical PCB",
            productKind: "pcb_finished_good",
            requiredQuantity: 50n,
            inventoryContext: {
              category: "Finished Goods",
              brandName: "AlfaEV",
              physicalQuantity: 9007199254740993n,
              committedToProjects: 9007199254740999n,
              availableAfterCommitments: -6n,
            },
          }],
        },
      ],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("get_project_planning", {
      p_project_id: projectId,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ required_quantity: 0 }, "zero quantity"],
    [{ required_quantity: 1.5 }, "fractional quantity"],
    [{ required_quantity: Number.MAX_SAFE_INTEGER + 1 }, "unsafe quantity"],
    [{ serial_number: "bad" }, "bad serial"],
    [{ product_kind: "unknown" }, "bad kind"],
    [{ product_name: " Product " }, "untrimmed name"],
  ])("fails safely for %s (%s)", async (override, _label) => {
    mocks.rpc.mockResolvedValue({
      data: [{
        project_product_id: groupId,
        project_product_name: "B24",
        component_id: componentId,
        product_id: productId,
        serial_number: "0000123",
        product_name: "Product",
        product_kind: "component",
        required_quantity: "1",
        category: "Control",
        brand_name: null,
        physical_quantity: "10",
        committed_to_projects: "2",
        available_after_commitments: "8",
        ...override,
      }],
      error: null,
    });
    await expect(getProjectPlanning(projectId)).resolves.toMatchObject({
      ok: false,
      error: { code: "load_failed" },
    });
  });

  it("preserves the base requirement while Inventory context is withheld", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        project_product_id: groupId,
        project_product_name: "B24",
        component_id: componentId,
        product_id: productId,
        serial_number: "0000123",
        product_name: "Product",
        product_kind: "component",
        required_quantity: "1",
        category: null,
        brand_name: null,
        physical_quantity: null,
        committed_to_projects: null,
        available_after_commitments: null,
      }],
      error: null,
    });
    await expect(getProjectPlanning(projectId)).resolves.toMatchObject({
      ok: true,
      value: [{
        requirements: [{ inventoryContext: null }],
      }],
    });
  });

  it.each([
    [{ available_after_commitments: "9" }, "inconsistent availability"],
    [{ physical_quantity: "-1" }, "negative physical quantity"],
    [{ committed_to_projects: "-1" }, "negative commitment"],
    [{ category: null }, "partial hidden context"],
  ])("rejects invalid Inventory context: %s (%s)", async (override, _label) => {
    mocks.rpc.mockResolvedValue({
      data: [{
        project_product_id: groupId,
        project_product_name: "B24",
        component_id: componentId,
        product_id: productId,
        serial_number: "0000123",
        product_name: "Product",
        product_kind: "component",
        required_quantity: "1",
        category: "Control",
        brand_name: null,
        physical_quantity: "10",
        committed_to_projects: "2",
        available_after_commitments: "8",
        ...override,
      }],
      error: null,
    });
    await expect(getProjectPlanning(projectId)).resolves.toMatchObject({
      ok: false,
      error: { code: "load_failed" },
    });
  });

  it("maps read errors without exposing provider text", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    await expect(getProjectPlanning(projectId)).resolves.toEqual({
      ok: false,
      error: {
        code: "load_failed",
        message: "The Project plan could not be loaded. Please try again.",
      },
    });
  });

  it("uses only the trusted active-Product choice RPC and normalizes search", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        product_id: productId,
        serial_number: "0000123",
        name: "Product",
        product_kind: "component",
      }],
      error: null,
    });
    await expect(searchPlanningProductChoices("  00001  ")).resolves.toEqual({
      ok: true,
      value: [{
        productId,
        serialNumber: "0000123",
        name: "Product",
        productKind: "component",
      }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "search_project_component_product_choices",
      { p_search: "00001" },
    );
  });

  it("sends only canonical mutation arguments, without Product or Inventory writes", async () => {
    mocks.rpc.mockResolvedValue({ data: groupId, error: null });
    await createProjectProduct(projectId, "  B24  ");
    await createProjectRequirement(groupId, productId, 5);
    await updateProjectRequirement(componentId, productId, 7);
    expect(mocks.rpc.mock.calls).toEqual([
      ["create_project_product", { p_project_id: projectId, p_name: "B24" }],
      ["create_project_product_component", {
        p_project_product_id: groupId,
        p_product_id: productId,
        p_required_quantity: 5,
      }],
      ["update_project_product_component", {
        p_component_id: componentId,
        p_product_id: productId,
        p_required_quantity: 7,
      }],
    ]);
  });

  it.each([
    ["42501", "access_denied"],
    ["PPL01", "project_closed"],
    ["PPL02", "duplicate_requirement"],
    ["PPL03", "children_present"],
    ["PPL04", "product_unavailable"],
    ["P0002", "not_found"],
    ["22023", "invalid_input"],
    ["XX000", "mutation_failed"],
  ])("maps %s to safe %s", async (providerCode, safeCode) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: providerCode, message: "private database detail" },
    });
    const result = await removeProjectProduct(groupId);
    expect(result).toMatchObject({
      ok: false,
      error: { code: safeCode },
    });
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });
});
