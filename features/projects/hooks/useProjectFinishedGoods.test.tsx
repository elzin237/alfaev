import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), permission: vi.fn(), read: vi.fn() }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("../../../app/auth/permissionService", () => ({ hasPermission: mocks.permission }));
vi.mock("../services/projectFinishedGoodsService", () => ({ getProjectFinishedGoods: mocks.read }));
import { useProjectFinishedGoods } from "./useProjectFinishedGoods";
import { projectFinishedGoodsQueryKeys } from "../projectFinishedGoodsQueryKeys";

const project = "00000000-0000-4000-8000-000000000001";
const auth = (id = "profile-1", admin = false) => ({ session: { user: { id: `auth-${id}` } }, profile: { id, isActive: true }, isAdmin: admin });
function setup(id = project) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ id }) => useProjectFinishedGoods(id), { wrapper, initialProps: { id } }) };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.useAuth.mockReturnValue(auth());
  mocks.permission.mockResolvedValue({ ok: true, value: true }); mocks.read.mockResolvedValue({ ok: true, value: [] });
});
afterEach(cleanup);

describe("Project FG read authorization and query isolation", () => {
  it("uses only both view permissions and a profile/Project-scoped authoritative query", async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.contextQuery.isSuccess).toBe(true));
    expect(mocks.permission.mock.calls.map(call => call[0]).sort()).toEqual(["inventory.finished_goods.view", "projects.view"]);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(project);
    expect(client.getQueryData(projectFinishedGoodsQueryKeys.context("profile-1", project))).toEqual({ ok: true, value: [] });
    expect(Object.keys(result.current)).not.toContain("reserve");
  });
  it("allows active Admin without requiring delegated grants", async () => {
    mocks.useAuth.mockReturnValue(auth("admin", true));
    const { result } = setup(); await waitFor(() => expect(result.current.canView).toBe(true));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce()); expect(mocks.permission).not.toHaveBeenCalled();
  });
  it.each(["projects.view", "inventory.finished_goods.view"])("does not fetch when %s is missing", async key => {
    mocks.permission.mockImplementation(async (permission: string) => ({ ok: true, value: permission !== key }));
    const { result } = setup(); await waitFor(() => expect(result.current.checkingPermissions).toBe(false));
    expect(result.current.canView).toBe(false); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("fails closed while permissions are pending or fail, even with protected data cached", async () => {
    mocks.permission.mockReturnValue(new Promise(() => {}));
    const { result, client } = setup();
    act(() => { client.setQueryData(projectFinishedGoodsQueryKeys.context("profile-1", project), { ok: true, value: ["cached"] }); });
    expect(result.current.checkingPermissions).toBe(true); expect(result.current.canView).toBe(false); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([{ ok: false, error: { message: "safe" } }, "throw"])("fails closed on permission errors %j", async error => {
    if (error === "throw") mocks.permission.mockRejectedValue(new Error("safe")); else mocks.permission.mockResolvedValue(error);
    const { result } = setup(); await waitFor(() => expect(result.current.permissionError).toBe(true));
    expect(result.current.canView).toBe(false); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([null, { ...auth(), session: null }, { ...auth("inactive", true), profile: { id: "inactive", isActive: false } }])("does not fetch for absent/inactive sessions %j", state => {
    mocks.useAuth.mockReturnValue(state ?? { profile: null, session: null, isAdmin: false });
    const { result } = setup(); expect(result.current.canView).toBe(false); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("disables malformed Project IDs", () => {
    mocks.useAuth.mockReturnValue(auth("admin", true));
    const { result } = setup("bad");
    expect(result.current.contextQuery.fetchStatus).toBe("idle");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not reuse another profile or Project's data, including a late response", async () => {
    let complete!: (value: unknown) => void;
    mocks.useAuth.mockReturnValue(auth("profile-1", true)); mocks.read.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const { result, rerender, client } = setup();
    mocks.useAuth.mockReturnValue(auth("profile-2", true)); rerender({ id: project });
    await waitFor(() => expect(result.current.contextQuery.data).toEqual({ ok: true, value: [] }));
    await act(async () => { complete({ ok: true, value: ["old profile only"] }); });
    expect(result.current.contextQuery.data).toEqual({ ok: true, value: [] });
    expect(client.getQueryData(projectFinishedGoodsQueryKeys.context("profile-1", project))).toEqual({ ok: true, value: ["old profile only"] });
    const other = "00000000-0000-4000-8000-000000000002"; rerender({ id: other });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(other));
    expect(client.getQueryData(projectFinishedGoodsQueryKeys.context("profile-2", other))).toEqual({ ok: true, value: [] });
  });
  it("hides access after revocation rather than treating cached data as authorization", async () => {
    const { result, client } = setup(); await waitFor(() => expect(result.current.canView).toBe(true));
    mocks.permission.mockResolvedValue({ ok: true, value: false });
    await act(async () => { await client.invalidateQueries({ queryKey: ["permission"] }); });
    await waitFor(() => expect(result.current.canView).toBe(false));
  });
});
