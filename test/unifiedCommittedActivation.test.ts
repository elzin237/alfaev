import {beforeEach,expect,it,vi} from "vitest";
const env=vi.hoisted(()=>({supabaseUrl:"https://yzysgbrpbhiapalgetau.supabase.co"}));
vi.mock("../lib/config/env",()=>({frontendEnv:env}));
import {isUnifiedCommittedEnabled,UNIFIED_COMMITTED_RELEASE} from "../app/config/unifiedCommittedActivation";
beforeEach(()=>{env.supabaseUrl="https://yzysgbrpbhiapalgetau.supabase.co";});
it("activates only the verified DEV backend after migration 181",()=>{expect(UNIFIED_COMMITTED_RELEASE.enabled).toBe(true);expect(UNIFIED_COMMITTED_RELEASE.requiredMigration).toBe("20261030210000");expect(isUnifiedCommittedEnabled()).toBe(true);});
it.each(["https://production.example","https://other-project.supabase.co","http://localhost:54321","http://yzysgbrpbhiapalgetau.supabase.co","https://yzysgbrpbhiapalgetau.supabase.co.evil.example"])("keeps other origins OFF: %s",origin=>{env.supabaseUrl=origin;expect(isUnifiedCommittedEnabled()).toBe(false);});
