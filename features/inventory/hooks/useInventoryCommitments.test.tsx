import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),raw:vi.fn(),fg:vi.fn()}));
vi.mock("../../../app/auth/AuthProvider",()=>({useAuth:mocks.auth}));
vi.mock("../services/inventoryCommitmentService",()=>({getInventoryCommitments:mocks.raw,
  getFinishedGoodsInventoryCommitments:mocks.fg,getProductProjectCommitments:vi.fn()}));
import { useInventoryCommitments } from "./useInventoryCommitments";
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockReturnValue({profile:{id:"profile-1",isActive:true}});
  mocks.raw.mockResolvedValue({ok:true,value:[]});mocks.fg.mockResolvedValue({ok:true,value:[]});});
afterEach(cleanup);
function setup(enabled=true,warehouse="finished_goods") {
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {client,...renderHook(({allowed,code})=>useInventoryCommitments(allowed,code),
    {wrapper,initialProps:{allowed:enabled,code:warehouse}})};
}
it("uses trusted warehouse aggregates and separates profile/warehouse cache keys",async()=>{
  const {result,client,rerender}=setup();await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(mocks.fg).toHaveBeenCalledOnce();expect(mocks.raw).not.toHaveBeenCalled();
  expect(client.getQueryData(["inventory","commitments","profile-1","warehouse","finished_goods"])).toEqual({ok:true,value:[]});
  mocks.auth.mockReturnValue({profile:{id:"profile-2",isActive:true}});rerender({allowed:true,code:"finished_goods"});
  await waitFor(()=>expect(mocks.fg).toHaveBeenCalledTimes(2));
  rerender({allowed:true,code:"raw_materials"});await waitFor(()=>expect(mocks.raw).toHaveBeenCalledOnce());
});
it("does not fetch on denied warehouse access or an inactive profile",async()=>{
  const {rerender}=setup(false);expect(mocks.fg).not.toHaveBeenCalled();
  mocks.auth.mockReturnValue({profile:{id:"profile-1",isActive:false}});rerender({allowed:true,code:"finished_goods"});
  expect(mocks.fg).not.toHaveBeenCalled();
});
