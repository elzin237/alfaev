import {afterEach,expect,it,vi} from "vitest";
const config=vi.hoisted(()=>({url:"https://yzysgbrpbhiapalgetau.supabase.co"}));
vi.mock("../lib/config/env",()=>({frontendEnv:{get supabaseUrl(){return config.url;}}}));
import {WORK_ORDER_COMMITMENT_READS_RELEASE,isWorkOrderCommitmentReadsEnabled} from "../app/config/workOrderCommitmentReadsActivation";
afterEach(()=>{config.url="https://yzysgbrpbhiapalgetau.supabase.co";});
it("enables accounting and source-popup reads only for the verified DEV backend",()=>{
  expect(WORK_ORDER_COMMITMENT_READS_RELEASE.enabled).toBe(true);expect(isWorkOrderCommitmentReadsEnabled()).toBe(true);
  expect(WORK_ORDER_COMMITMENT_READS_RELEASE.backendOrigin).toBe("https://yzysgbrpbhiapalgetau.supabase.co");expect(WORK_ORDER_COMMITMENT_READS_RELEASE.requiredMigration).toBe("20261030160000");
});
it.each(["https://other.supabase.co","http://localhost:54321","https://yzysgbrpbhiapalgetau.supabase.co.attacker.invalid"])("keeps other backend origin OFF: %s",url=>{config.url=url;expect(isWorkOrderCommitmentReadsEnabled()).toBe(false);});
