import {expect,it,vi} from "vitest";
const env=vi.hoisted(()=>({supabaseUrl:"https://yzysgbrpbhiapalgetau.supabase.co"}));
vi.mock("../../lib/config/env",()=>({frontendEnv:env}));
import {isWorkOrderActiveShortagesEnabled,WORK_ORDER_ACTIVE_SHORTAGES_RELEASE} from "./workOrderActiveShortagesActivation";
it("opens verified migration-166 tracking only for the configured DEV backend",()=>{
 expect(WORK_ORDER_ACTIVE_SHORTAGES_RELEASE.enabled).toBe(true);
 expect(isWorkOrderActiveShortagesEnabled()).toBe(true);
 expect(Object.isFrozen(WORK_ORDER_ACTIVE_SHORTAGES_RELEASE)).toBe(true);
 expect(WORK_ORDER_ACTIVE_SHORTAGES_RELEASE.requiredMigration).toBe("20261029110000");
 for(const url of ["https://other.supabase.co","http://localhost:54321"]){env.supabaseUrl=url;expect(isWorkOrderActiveShortagesEnabled()).toBe(false);}
 env.supabaseUrl="https://yzysgbrpbhiapalgetau.supabase.co";
});
