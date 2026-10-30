import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const file="20261030200000_add_unified_committed_contracts.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("is forward migration 180 and preserves the reviewed evidence foundations",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[179]).toBe(file);
  for(const [name,hash] of [["20261030180000_add_work_order_requirement_attribution.sql","43ee6d2f9166dd42aec014358f624ee5e013878e2f2cf90ba60782b34bd24d2c"],["20261030190000_add_exact_project_requirement_coverage.sql","60de47b4ff3e8a5d7e95f15635d1763309563565b1772b93347471de16d2b4f3"]])expect(createHash("sha256").update(readFileSync(`supabase/migrations/${name}`)).digest("hex")).toBe(hash);
});
it("delegates Admin declarations and keeps unknown totals null without altering accounting",()=>{
  expect(sql).toContain("Active Admin required");expect(sql).toContain("public.declare_work_order_requirement_coverage");expect(sql).toContain("public.declare_work_order_material_independence");
  expect(sql).toContain("when unknown_overlap=0 then demand+held-adjustment else null");expect(sql).toContain("required_quantity=verified_coverage_quantity+admin_independent_quantity");
  expect(sql).not.toMatch(/create or replace|(?:insert into|update|delete from) public\./i);
});
it("preserves the independently authorized DEV-only release boundary",()=>{const gate=readFileSync("app/config/unifiedCommittedActivation.ts","utf8");expect(gate).toContain("enabled:true");expect(gate).toContain("yzysgbrpbhiapalgetau");expect(gate).toContain("origin===UNIFIED_COMMITTED_RELEASE.backendOrigin");});
