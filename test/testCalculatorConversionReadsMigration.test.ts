import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
const file="20261030100000_add_test_calculation_conversion_reads.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("is additive migration 170 preserving approved 167–169",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_/.test(f)).sort()[169]).toBe(file);
  expect(createHash("sha256").update(readFileSync("supabase/migrations/20261029140000_add_atomic_test_calculator_import.sql")).digest("hex")).toBe("7bdc2cddcb9917d0e6023341d395a8cd572b5824d25227cefdb9fb3de03b016a");
  expect(sql).not.toMatch(/create or replace|(?:insert into|update|delete from) public\./i);
});
it("uses active Test authority, independent destination authorization and no private grants",()=>{
  for(const text of ["current_active_user_profile_id()","has_permission('test_calculator.view')","has_permission('pcb.view')","security definer set search_path = ''","from public,anon,authenticated,service_role","between 1 and 100"])expect(sql).toContain(text);
  expect(sql).not.toMatch(/create policy|grant (select|insert|update|delete)/i);
});
it("uses one authoritative time and canonical release-aware commitments without snapshots or accounting mutation",()=>{
  expect(sql.match(/clock_timestamp/g)).toHaveLength(1);expect(sql).toContain("public.active_test_holds_at(observed_at,");expect(sql).toContain("hold.calculation_id=any(p_calculation_ids)");
  expect(sql).toContain("'effective_quantity'");expect(sql).toContain("::text");
});
