import { expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ supabaseUrl: "https://yzysgbrpbhiapalgetau.supabase.co" }));
vi.mock("../../lib/config/env", () => ({ frontendEnv: env }));
import { WORK_ORDER_AVAILABILITY_RELEASE, isWorkOrderAvailabilityEnabled } from "./workOrderAvailabilityActivation";
it("opens migration-162 reads only for the approved DEV backend", () => {
  expect(WORK_ORDER_AVAILABILITY_RELEASE.enabled).toBe(true);
  expect(WORK_ORDER_AVAILABILITY_RELEASE.requiredMigration).toBe("20261028130000");
  expect(WORK_ORDER_AVAILABILITY_RELEASE.backendOrigin).toBe("https://yzysgbrpbhiapalgetau.supabase.co");
  expect(Object.isFrozen(WORK_ORDER_AVAILABILITY_RELEASE)).toBe(true);
  env.supabaseUrl = "https://yzysgbrpbhiapalgetau.supabase.co";
  expect(isWorkOrderAvailabilityEnabled()).toBe(true);
  for (const url of ["https://other.supabase.co", "http://localhost:54321"]) {
    env.supabaseUrl = url; expect(isWorkOrderAvailabilityEnabled()).toBe(false);
  }
});
