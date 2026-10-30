import {QueryClient} from "@tanstack/react-query";
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({enabled:true,unified:false}));
vi.mock("../../app/config/workOrderCommitmentReadsActivation",()=>({isWorkOrderCommitmentReadsEnabled:()=>mocks.enabled}));
vi.mock("../../app/config/unifiedCommittedActivation",()=>({isUnifiedCommittedEnabled:()=>mocks.unified}));
import {refreshUnsignalledWorkOrderCommitments} from "./refreshWorkOrderCommitmentReads";
import {inventoryReservationAccountingPrefix} from "./services/inventoryReservationAccountingService";
import {inventoryCommitmentBreakdownPrefix} from "./services/inventoryCommitmentBreakdownService";
import {unifiedCommittedPrefix} from "./services/unifiedCommittedService";
beforeEach(()=>{mocks.enabled=true;mocks.unified=false;});
it("refreshes unified scoped readers even when the legacy read gate is OFF",async()=>{mocks.enabled=false;mocks.unified=true;const client=new QueryClient(),own=[...unifiedCommittedPrefix("actor","profile"),"product"],other=[...unifiedCommittedPrefix("other","profile"),"product"];[own,other].forEach(k=>client.setQueryData(k,{}));await refreshUnsignalledWorkOrderCommitments(client,"actor","profile");expect(client.getQueryState(own)?.isInvalidated).toBe(true);expect(client.getQueryState(other)?.isInvalidated).toBe(false);client.clear();});
it("does not invalidate the same popup twice when both read gates are ON",async()=>{mocks.unified=true;const client=new QueryClient(),invalidate=vi.spyOn(client,"invalidateQueries");await refreshUnsignalledWorkOrderCommitments(client,"actor","profile");expect(invalidate.mock.calls.filter(([filters])=>filters?.queryKey?.[0]==="inventory-commitment-breakdown")).toHaveLength(1);client.clear();});
it("refreshes only the actor/profile readers when there is no cached list to emit the usual signal",async()=>{
  const client=new QueryClient(),own=[...inventoryReservationAccountingPrefix("actor","profile"),"table"],popup=[...inventoryCommitmentBreakdownPrefix("actor","profile"),"popup"],other=[...inventoryReservationAccountingPrefix("other","profile"),"table"];
  [own,popup,other].forEach(k=>client.setQueryData(k,{}));
  await refreshUnsignalledWorkOrderCommitments(client,"actor","profile");
  expect(client.getQueryState(own)?.isInvalidated).toBe(true);expect(client.getQueryState(popup)?.isInvalidated).toBe(true);expect(client.getQueryState(other)?.isInvalidated).toBe(false);client.clear();
});
it("does not duplicate the existing cached-list invalidation subscription",async()=>{
  const client=new QueryClient();client.setQueryData(["work-orders","list","profile"],{});const invalidate=vi.spyOn(client,"invalidateQueries");
  await refreshUnsignalledWorkOrderCommitments(client,"actor","profile");expect(invalidate).not.toHaveBeenCalled();client.clear();
});
it.each(["gate","actor","profile"])("does nothing when %s is unavailable",async missing=>{
  const client=new QueryClient(),invalidate=vi.spyOn(client,"invalidateQueries");if(missing==="gate")mocks.enabled=false;
  await refreshUnsignalledWorkOrderCommitments(client,missing==="actor"?undefined:"actor",missing==="profile"?undefined:"profile");expect(invalidate).not.toHaveBeenCalled();client.clear();
});
