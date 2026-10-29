import { beforeEach, expect, it, vi } from "vitest";
const env=vi.hoisted(()=>({supabaseUrl:"https://yzysgbrpbhiapalgetau.supabase.co"}));
vi.mock("../../lib/config/env",()=>({frontendEnv:env}));
import { INVENTORY_STOCK_HEALTH_RELEASE, isInventoryStockHealthEnabled } from "./inventoryStockHealthActivation";
beforeEach(()=>{env.supabaseUrl="https://yzysgbrpbhiapalgetau.supabase.co";});
it("opens the reviewed Low Stock release only on the pinned DEV backend",()=>{
  expect(INVENTORY_STOCK_HEALTH_RELEASE.enabled).toBe(true);
  expect(INVENTORY_STOCK_HEALTH_RELEASE.backendOrigin).toBe("https://yzysgbrpbhiapalgetau.supabase.co");
  expect(INVENTORY_STOCK_HEALTH_RELEASE.requiredMigration).toBe("20261028110000");
  expect(Object.isFrozen(INVENTORY_STOCK_HEALTH_RELEASE)).toBe(true);
  expect(isInventoryStockHealthEnabled()).toBe(true);
});
it.each(["https://another-project.supabase.co","http://yzysgbrpbhiapalgetau.supabase.co","https://yzysgbrpbhiapalgetau.supabase.co.example.org","http://127.0.0.1:54321"])("keeps the feature closed for %s",url=>{
  env.supabaseUrl=url;expect(isInventoryStockHealthEnabled()).toBe(false);
});
