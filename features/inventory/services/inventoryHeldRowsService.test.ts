import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("./inventoryReservationAccountingService",()=>({getInventoryReservationAccounting:mocks.read}));
import {getInventoryHeldRows} from "./inventoryHeldRowsService";
const row=(id:string)=>({productId:id,warehouseWorkOrderHeld:"9007199254740993",netAvailableAfterAllCommitments:"-8"});
const page=(items:ReturnType<typeof row>[],hasMore=false)=>({ok:true,value:{items,hasMore,asOf:"2026-10-30T10:00:00Z"}});
beforeEach(()=>vi.resetAllMocks());
it("uses bounded active+archived pages and preserves exact strings",async()=>{
  mocks.read.mockResolvedValueOnce(page([row("one")],true)).mockResolvedValueOnce(page([row("two")]));
  const signal=new AbortController().signal;
  expect(await getInventoryHeldRows("raw","part","token",signal)).toMatchObject({ok:true,value:{items:[row("one"),row("two")],observations:[expect.any(String),expect.any(String)]}});
  expect(mocks.read.mock.calls).toEqual([["raw","part","token",null,200,0,signal],["raw","part","token",null,200,200,signal]]);
});
it("does not silently truncate at the catalog safety boundary",async()=>{
  mocks.read.mockImplementation((_w,_s,_t,_a,_l,offset)=>Promise.resolve(page([row(String(offset))],true)));
  expect(await getInventoryHeldRows("raw","","token")).toMatchObject({ok:false,error:{message:expect.stringContaining("1,000")}});
  expect(mocks.read).toHaveBeenCalledTimes(5);
});
it("rejects duplicate pairs caused by changing offset pages",async()=>{
  mocks.read.mockResolvedValueOnce(page([row("same")],true)).mockResolvedValueOnce(page([row("same")]));
  expect(await getInventoryHeldRows("raw","","token")).toMatchObject({ok:false,error:{message:expect.stringContaining("pagination")}});
});
it("does not expose a partial result after a later page fails",async()=>{
  mocks.read.mockResolvedValueOnce(page([row("one")],true)).mockResolvedValueOnce({ok:false,error:{code:"access_denied",message:"Unavailable"}});
  expect(await getInventoryHeldRows("raw","","token")).toEqual({ok:false,error:{code:"access_denied",message:"Unavailable"}});
});
it("accepts an authoritative empty catalog without inventing rows",async()=>{
  mocks.read.mockResolvedValue(page([]));expect(await getInventoryHeldRows("fg","","token")).toMatchObject({ok:true,value:{items:[]}});
});
