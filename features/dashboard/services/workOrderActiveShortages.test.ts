import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({enabled:true,rpc:vi.fn()}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("../../../app/config/workOrderNotificationsActivation",()=>({isWorkOrderNotificationsEnabled:()=>true}));
vi.mock("../../../app/config/workOrderActiveShortagesActivation",()=>({isWorkOrderActiveShortagesEnabled:()=>mocks.enabled}));
import {getProjectAlertUnreadCount,listProjectAlertNotifications} from "./projectAlertService";
const id="00000000-0000-4000-8000-000000000001",time="2026-10-29T10:00:00.123456+01:00";
const row={target_type:"work_order",notification_id:id,event_id:id,episode_id:id,episode_status:"active",
 notification_kind:"work_order_shortage",work_order_id:id,work_order_number:"RN-2026-0041",product_id:id,
 product_name:"Relay",shortage_event_type:"opened",shortage_quantity:"9007199254740993",created_at:time,read_at:time,has_more:false};
beforeEach(()=>{vi.resetAllMocks();mocks.enabled=true});
it("uses the tracking RPC and preserves a read active episode and exact current quantities",async()=>{
 mocks.rpc.mockResolvedValue({data:[row],error:null});const r=await listProjectAlertNotifications();
 expect(mocks.rpc).toHaveBeenCalledWith("list_dashboard_shortage_tracking",expect.any(Object));
 expect(r.ok&&r.value.items[0]).toMatchObject({episodeStatus:"active",episodeId:id,readAt:time,shortageQuantity:"9007199254740993"});
});
it("keeps red active count separate from unread Project messages",async()=>{
 mocks.rpc.mockResolvedValue({data:{active_work_order_shortages:"2",unread_project_notifications:"9007199254740993",as_of:time},error:null});
 const r=await getProjectAlertUnreadCount();expect(r.ok&&r.value).toMatchObject({exactValue:2n,projectUnread:9007199254740993n,asOf:time});
 expect(mocks.rpc).toHaveBeenCalledWith("get_dashboard_alert_counts");
});
it("accepts resolved/read rows but rejects unresolved/read contract mismatches",async()=>{
 mocks.rpc.mockResolvedValue({data:[{...row,episode_status:"resolved",shortage_event_type:"resolved",shortage_quantity:"0"}],error:null});
 expect((await listProjectAlertNotifications()).ok).toBe(true);
 mocks.rpc.mockResolvedValue({data:[{...row,episode_status:"resolved"}],error:null});expect((await listProjectAlertNotifications()).ok).toBe(false);
 mocks.rpc.mockResolvedValue({data:[{...row,episode_status:"resolved",shortage_event_type:"resolved",shortage_quantity:"0",read_at:null}],error:null});
 expect((await listProjectAlertNotifications()).ok).toBe(false);
});
it.each([null,{active_work_order_shortages:2,unread_project_notifications:"1",as_of:time},
 {active_work_order_shortages:"-1",unread_project_notifications:"1",as_of:time}])("fails closed on malformed counts %s",async data=>{
 mocks.rpc.mockResolvedValue({data,error:null});expect((await getProjectAlertUnreadCount()).ok).toBe(false);
});
it("OFF keeps the currently deployed contracts and never invokes tracking RPCs",async()=>{
 mocks.enabled=false;mocks.rpc.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:"0",error:null});
 await listProjectAlertNotifications();await getProjectAlertUnreadCount();
 expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["list_dashboard_notifications","get_dashboard_notification_unread_count"]);
});
