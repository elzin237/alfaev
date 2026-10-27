import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), auth: vi.fn() }));
vi.mock("../services/testCalculationPreviewService", () => ({ previewTestCalculation: mocks.preview }));
vi.mock("../../../app/auth/AuthProvider", () => ({ useAuth: mocks.auth }));
import { useTestCalculationPreview } from "./useTestCalculationPreview";
import type { TestCalculationDraft } from "../testCalculationDraft";
const draft: TestCalculationDraft = { name: "Test", deadlineDate: "2090-01-01", items: [{ quantity: "9007199254740993", product: {
  productId: "20000000-0000-4000-8000-000000000001", name: "Component", serialNumber: "0000123", productKind: "component", sourcePolicy: "raw_customs_fg",
} }] };
const active = { session: { user: { id: "auth-a" } }, profile: { id: "profile-a", authUserId: "auth-a", isActive: true }, isActive: true, isLoading: false, error: null };
function setup(enabled=true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ current })=>useTestCalculationPreview(current,enabled), { wrapper, initialProps: { current: draft } }) };
}
beforeEach(()=> { mocks.auth.mockReturnValue(active); mocks.preview.mockResolvedValue({ ok: false, error: { code: "access_denied", message: "Denied" } }); });
afterEach(()=> { cleanup(); vi.resetAllMocks(); });
describe("identity-scoped imperative Test preview",()=> {
  it("never auto-fetches and keeps exact payload in an actor/profile/draft-scoped query",async()=> {
    const { result,client }=setup(); expect(mocks.preview).not.toHaveBeenCalled();
    await act(async()=>{await result.current.prove();});
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith([{ product_id: draft.items[0]!.product.productId, quantity: "9007199254740993" }]);
    expect(client.getQueryCache().getAll().some(q=> q.queryKey[0]==="test-calculation-preview" && q.queryKey[1]==="auth-a" && q.queryKey[2]==="profile-a" && q.queryKey[3]===JSON.stringify(draft))).toBe(true);
    expect(result.current.error).toBe("Denied"); expect(result.current.preview).toBeNull();
  });
  it("fails closed when activation is absent",async()=> {
    const { result }=setup(false); await act(async()=>{await result.current.prove();});
    expect(mocks.preview).not.toHaveBeenCalled(); expect(result.current.preview).toBeNull();
  });
  it.each([{ session:null },{ profile:null },{ isActive:false },{ isLoading:true },
    { profile:{ ...active.profile,isActive:false } },{ profile:{ ...active.profile,id:"" } },{ profile:{ ...active.profile,authUserId:"wrong" } },{ error:{ code:"failed" } }])("rejects unverifiable identity %j",async override=> {
    mocks.auth.mockReturnValue({ ...active,...override });const { result }=setup();
    await act(async()=>{await result.current.prove();});expect(mocks.preview).not.toHaveBeenCalled();expect(result.current.error).toContain("could not be verified");
  });
  it("does not dispatch invalid drafts",async()=> {
    const { result,rerender }=setup();rerender({ current:{ ...draft,items:[] } });
    await act(async()=>{await result.current.prove();});expect(mocks.preview).not.toHaveBeenCalled();
  });
});
