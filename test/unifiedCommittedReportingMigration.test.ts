import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();
const file="20261030220000_simplify_unified_committed_reporting.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("adds only forward migration 182 and preserves reviewed migrations 178–181",()=>{
  expect(files[181]).toBe(file);
  const hashes=["43ee6d2f9166dd42aec014358f624ee5e013878e2f2cf90ba60782b34bd24d2c","60de47b4ff3e8a5d7e95f15635d1763309563565b1772b93347471de16d2b4f3","e354359704c0aab8215ee18c7088fbd2a18d44468882d5c4cebacead3276db01","a23cbe35b02db9162ae9fe37fca582654880c54847d807e83b1e99338f5552d7"];
  expect(files.slice(177,181).map(f=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(hashes);
});
it("replaces only two read contracts without changing accounting or historical evidence",()=>{
  expect([...sql.matchAll(/create or replace function public\.([a-z_]+)/g)].map(m=>m[1])).toEqual(["get_inventory_unified_committed","get_inventory_unified_commitment_breakdown"]);
  expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create table|alter table|truncate)\b/i);
  expect(sql).toContain("(demand+held)::text");expect(sql).toContain("public.active_draft_warehouse_hold_quantity");
  expect(sql).not.toContain("work_order_requirement_attribution");expect(sql).not.toContain("unknown_overlap");
  expect(sql).toContain("'metric_definition','project_demand_plus_work_order_held'");
});
it("preserves trusted scopes, source redaction, bounded pagination and grants",()=>{
  expect(sql.match(/stable security definer set search_path=''/g)).toHaveLength(2);
  for(const text of ["current_active_user_profile_id","inventory.customs.view","projects.view","work_orders.view","p_limit>100","ICB01","auth.uid()","restricted_subtotal","from public,anon,authenticated,service_role","to authenticated"])expect(sql).toContain(text);
});
