import {expect,it,vi} from "vitest";
const env=vi.hoisted(()=>({supabaseUrl:"https://yzysgbrpbhiapalgetau.supabase.co"}));
vi.mock("../../lib/config/env",()=>({frontendEnv:env}));
import {WORK_ORDER_NOTIFICATIONS_RELEASE,isWorkOrderNotificationsEnabled} from "./workOrderNotificationsActivation";
it("opens Work Order notifications only for the verified DEV backend",()=>{
  expect(WORK_ORDER_NOTIFICATIONS_RELEASE.enabled).toBe(true);
  expect(WORK_ORDER_NOTIFICATIONS_RELEASE.backendOrigin).toBe("https://yzysgbrpbhiapalgetau.supabase.co");
  expect(WORK_ORDER_NOTIFICATIONS_RELEASE.requiredMigration).toBe("20261028150000");
  expect(Object.isFrozen(WORK_ORDER_NOTIFICATIONS_RELEASE)).toBe(true);
  expect(isWorkOrderNotificationsEnabled()).toBe(true);
  for(const url of ["https://other.supabase.co","http://localhost:54321"]){
    env.supabaseUrl=url;expect(isWorkOrderNotificationsEnabled()).toBe(false);
  }
});
