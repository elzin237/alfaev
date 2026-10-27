import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  hasPermission: vi.fn(),
  getProjectPlanning: vi.fn(),
  searchPlanningProductChoices: vi.fn(),
  createProjectProduct: vi.fn(),
  createProjectRequirement: vi.fn(),
  updateProjectProduct: vi.fn(),
  updateProjectRequirement: vi.fn(),
  removeProjectProduct: vi.fn(),
  removeProjectRequirement: vi.fn(),
  requirementExecute: vi.fn(),
  fgCommitments: vi.fn(),
}));
vi.mock("../../inventory/services/inventoryCommitmentService", () => ({
  getFinishedGoodsInventoryCommitments: mocks.fgCommitments,
  getInventoryCommitments: vi.fn(), getProductProjectCommitments: vi.fn(),
}));
vi.mock("./useProjectRequirementMutations",()=>({useProjectRequirementMutations:()=>({execute:mocks.requirementExecute})}));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("../services/projectPlanningService", () => ({
  getProjectPlanning: mocks.getProjectPlanning,
  searchPlanningProductChoices: mocks.searchPlanningProductChoices,
  createProjectProduct: mocks.createProjectProduct,
  createProjectRequirement: mocks.createProjectRequirement,
  updateProjectProduct: mocks.updateProjectProduct,
  updateProjectRequirement: mocks.updateProjectRequirement,
  removeProjectProduct: mocks.removeProjectProduct,
  removeProjectRequirement: mocks.removeProjectRequirement,
}));

import { useProjectPlanning } from "./useProjectPlanning";
import {
  projectPlanningChoicesQueryKey,
  projectPlanningQueryKey,
} from "../projectPlanningQueryKeys";

const projectId = "00000000-0000-4000-8000-000000000001";

function renderPlanning(status: "planned" | "completed" | "cancelled" = "planned") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useProjectPlanning(projectId, status, true, "  Relay  "), { wrapper }),
    queryClient,
  };
}

beforeEach(() => {
  mocks.fgCommitments.mockResolvedValue({ ok: true, value: [] });
  mocks.useAuth.mockReturnValue({
    session: { user: { id: "auth-1" } },
    profile: { id: "profile-1", isActive: true },
    isAdmin: false,
  });
  mocks.hasPermission.mockResolvedValue({ ok: true, value: false });
  mocks.getProjectPlanning.mockResolvedValue({ ok: true, value: [] });
  mocks.searchPlanningProductChoices.mockResolvedValue({ ok: true, value: [] });
  for (const name of [
    "createProjectProduct", "createProjectRequirement",
    "updateProjectProduct", "updateProjectRequirement",
    "removeProjectProduct", "removeProjectRequirement",
  ] as const) {
    mocks[name].mockResolvedValue({
      ok: true, value: { id: "00000000-0000-4000-8000-000000000002" },
    });
  }
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("useProjectPlanning", () => {
  it("loads FG aggregates only for FG requirements and isolates them by authenticated profile", async () => {
    const rendered = renderPlanning();
    await waitFor(() => expect(rendered.result.current.planningQuery.isSuccess).toBe(true));
    expect(mocks.fgCommitments).not.toHaveBeenCalled();
    mocks.getProjectPlanning.mockResolvedValue({ ok: true, value: [{ id: "group", requirements: [
      { productId: "product", productKind: "pcb_finished_good" },
    ] }] });
    await act(async () => { await rendered.result.current.planningQuery.refetch(); });
    await waitFor(() => expect(rendered.result.current.finishedGoodsCommitmentsQuery.isSuccess).toBe(true));
    expect(mocks.fgCommitments).toHaveBeenCalledOnce();
    expect(rendered.queryClient.getQueryData(["inventory", "commitments", "profile-1", "warehouse", "finished_goods"]))
      .toEqual({ ok: true, value: [] });
    mocks.useAuth.mockReturnValue({ session: { user: { id: "auth-2" } }, profile: { id: "profile-2", isActive: true }, isAdmin: false });
    rendered.rerender();
    await waitFor(() => expect(mocks.fgCommitments).toHaveBeenCalledTimes(2));
    expect(rendered.queryClient.getQueryData(["inventory", "commitments", "profile-2", "warehouse", "finished_goods"]))
      .toEqual({ ok: true, value: [] });
  });

  it("routes FG create/edit/remove through one atomic request and carries expected state losslessly",async()=>{
    const groupId="00000000-0000-4000-8000-000000000002",componentId="00000000-0000-4000-8000-000000000003",productId="00000000-0000-4000-8000-000000000004";
    mocks.useAuth.mockReturnValue({session:{user:{id:"admin"}},profile:{id:"profile",isActive:true},isAdmin:true});
    mocks.getProjectPlanning.mockResolvedValue({ok:true,value:[{id:groupId,requirements:[{id:componentId,productId,productKind:"pcb_finished_good",requiredQuantity:9007199254740993n}]}]});
    mocks.searchPlanningProductChoices.mockResolvedValue({ok:true,value:[{productId,productKind:"pcb_finished_good"}]});
    mocks.requirementExecute.mockResolvedValue({ok:true,value:{id:componentId}});
    const r=renderPlanning();await waitFor(()=>expect(r.result.current.choicesQuery.isSuccess).toBe(true));
    await act(async()=>{await r.result.current.createRequirement(groupId,productId,"9007199254740993");});
    expect(mocks.requirementExecute).toHaveBeenLastCalledWith({operation:"create",projectId,groupId,componentId:null,productId,quantity:"9007199254740993",expectedProductId:null,expectedQuantity:null});
    await act(async()=>{await r.result.current.updateRequirement(componentId,productId,"9007199254740994");});
    expect(mocks.requirementExecute).toHaveBeenLastCalledWith(expect.objectContaining({operation:"update",componentId,quantity:"9007199254740994",expectedQuantity:"9007199254740993"}));
    await act(async()=>{await r.result.current.removeRequirement(componentId);});
    expect(mocks.requirementExecute).toHaveBeenLastCalledWith(expect.objectContaining({operation:"remove",componentId,productId:null,quantity:null,expectedProductId:productId}));
    expect(mocks.createProjectRequirement).not.toHaveBeenCalled();expect(mocks.updateProjectRequirement).not.toHaveBeenCalled();expect(mocks.removeProjectRequirement).not.toHaveBeenCalled();
  });
  it("isolates planning and choices by identity/Project/search and permits Admin without a permission RPC", async () => {
    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true },
      isAdmin: true,
    });
    const { result, queryClient } = renderPlanning();
    await waitFor(() => expect(result.current.planningQuery.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.choicesQuery.isSuccess).toBe(true));
    expect(result.current.canManage).toBe(true);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(projectPlanningQueryKey("admin-profile", projectId)))
      .toEqual({ ok: true, value: [] });
    expect(queryClient.getQueryData(
      projectPlanningChoicesQueryKey("admin-profile", projectId, "Relay"),
    )).toEqual({ ok: true, value: [] });
    expect(mocks.searchPlanningProductChoices).toHaveBeenCalledWith("Relay");
  });

  it("fails controls closed for view-only, pending, error, missing profile, and closed lifecycle", async () => {
    const viewOnly = renderPlanning();
    await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
    expect(viewOnly.result.current.canManage).toBe(false);
    expect(mocks.searchPlanningProductChoices).not.toHaveBeenCalled();
    viewOnly.unmount();

    mocks.hasPermission.mockReturnValue(new Promise(() => undefined));
    const pending = renderPlanning();
    expect(pending.result.current.canManage).toBe(false);
    pending.unmount();

    mocks.hasPermission.mockResolvedValue({ ok: false, error: { message: "safe" } });
    const failed = renderPlanning();
    await waitFor(() => expect(failed.result.current.planningQuery.isSuccess).toBe(true));
    expect(failed.result.current.canManage).toBe(false);
    failed.unmount();

    mocks.useAuth.mockReturnValue({
      session: { user: { id: "admin-auth" } },
      profile: { id: "admin-profile", isActive: true },
      isAdmin: true,
    });
    for (const status of ["completed", "cancelled"] as const) {
      const closed = renderPlanning(status);
      expect(closed.result.current.canManage).toBe(false);
      closed.unmount();
    }
    mocks.useAuth.mockReturnValue({ session: null, profile: null, isAdmin: false });
    const missing = renderPlanning();
    expect(missing.result.current.planningQuery.fetchStatus).toBe("idle");
    expect(missing.result.current.canManage).toBe(false);
  });

  it("allows projects.edit without inventory.view and invalidates planning plus Inventory commitments after success", async () => {
    mocks.hasPermission.mockImplementation((key: string) =>
      Promise.resolve({ ok: true, value: key === "projects.edit" })
    );
    const { result, queryClient } = renderPlanning();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.canManage).toBe(true));
    await waitFor(() => expect(result.current.choicesQuery.isSuccess).toBe(true));
    await act(async () => { await result.current.createGroup("B24"); });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectPlanningQueryKey("profile-1", projectId),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["inventory", "commitments", "profile-1"],
    });
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects", "finished-goods", "profile-1"] });
    expect(mocks.hasPermission).toHaveBeenCalledWith("projects.edit");
    invalidate.mockClear();
    await act(async () => {
      await result.current.updateRequirement(
        "component-id", "product-id", "9007199254740993",
      );
    });
    expect(mocks.updateProjectRequirement).toHaveBeenCalledWith(
      "component-id", "product-id", "9007199254740993",
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: projectPlanningQueryKey("profile-1", projectId),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["inventory", "commitments", "profile-1"],
    });
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects", "finished-goods", "profile-1"] });
    invalidate.mockClear();
    mocks.removeProjectProduct.mockResolvedValueOnce({
      ok: false, error: { code: "children_present", message: "safe" },
    });
    await act(async () => { await result.current.removeGroup("group-id"); });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
