import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),enabled:true}));
vi.mock("../../../lib/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("../../../app/config/workOrderNotificationsActivation",()=>({isWorkOrderNotificationsEnabled:()=>mocks.enabled}));
// Retain explicit coverage of the deployed legacy-message contract when tracking is OFF.
vi.mock("../../../app/config/workOrderActiveShortagesActivation",()=>({isWorkOrderActiveShortagesEnabled:()=>false}));
import { dashboardAlertDestination,dashboardAlertLabel,listProjectAlertNotifications,getProjectAlertUnreadCount,
  markProjectAlertRead,dismissProjectAlertNotification } from "./projectAlertService";
const id="00000000-0000-4000-8000-000000000001",time="2026-10-29T09:00:00.123456+02:00";
const row={target_type:"work_order",notification_id:id,event_id:id,notification_kind:"work_order_shortage",
  work_order_id:id,work_order_number:"RN-2026-0010",product_id:id,product_name:"Relay",shortage_event_type:"opened",
  shortage_quantity:"9007199254740993",created_at:time,read_at:null,has_more:false};
beforeEach(()=>{vi.resetAllMocks();mocks.enabled=true;});
it("loads explicit Work Order targets and preserves bigint history and routing",async()=>{
  mocks.rpc.mockResolvedValue({data:[row],error:null});
  const result=await listProjectAlertNotifications();expect(result.ok).toBe(true);if(!result.ok)return;
  expect(mocks.rpc).toHaveBeenCalledWith("list_dashboard_notifications",{p_limit:20,p_before_created_at:null,p_before_recipient_id:null});
  expect(result.value.items[0]).toMatchObject({targetType:"work_order",shortageQuantity:"9007199254740993",projectId:null});
  expect(dashboardAlertDestination(result.value.items[0]!)).toBe(`/work-orders/${id}`);
  expect(dashboardAlertLabel(result.value.items[0]!)).toBe("RN-2026-0010");
});
it.each(["-1","1.5","9223372036854775808",3])("rejects malformed historical quantities %s",async quantity=>{
  mocks.rpc.mockResolvedValue({data:[{...row,shortage_quantity:quantity}],error:null});
  expect((await listProjectAlertNotifications()).ok).toBe(false);
});
it("distinguishes resolution and rejects leaked private fields",async()=>{
  mocks.rpc.mockResolvedValue({data:[{...row,shortage_event_type:"resolved",shortage_quantity:"0"}],error:null});
  expect((await listProjectAlertNotifications()).ok).toBe(true);
  mocks.rpc.mockResolvedValue({data:[{...row,recipient_user_id:id}],error:null});
  expect((await listProjectAlertNotifications()).ok).toBe(false);
});
it("routes owner updates and exact unread counts through combined RPCs",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:"9007199254740993",error:null});
  const count=await getProjectAlertUnreadCount();expect(count.ok&&count.value.exactValue).toBe(9007199254740993n);
  mocks.rpc.mockResolvedValueOnce({data:[{notification_id:id,read_at:time}],error:null});
  expect((await markProjectAlertRead(id)).ok).toBe(true);
  mocks.rpc.mockResolvedValueOnce({data:[{notification_id:id,dismissed_at:time}],error:null});
  expect((await dismissProjectAlertNotification(id)).ok).toBe(true);
  expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(["get_dashboard_notification_unread_count","mark_dashboard_notification_read","dismiss_dashboard_notification"]);
});
it("switch OFF calls only legacy Project contracts",async()=>{
  mocks.enabled=false;mocks.rpc.mockResolvedValue({data:[],error:null});await listProjectAlertNotifications();
  expect(mocks.rpc.mock.calls[0]![0]).toBe("list_project_notifications");
});
