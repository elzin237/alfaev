import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const file="20261030190000_add_exact_project_requirement_coverage.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("is forward migration 179 and preserves migration 178 exactly",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[178]).toBe(file);
  expect(createHash("sha256").update(readFileSync("supabase/migrations/20261030180000_add_work_order_requirement_attribution.sql")).digest("hex")).toBe("43ee6d2f9166dd42aec014358f624ee5e013878e2f2cf90ba60782b34bd24d2c");
});
it("keeps private Admin authority and controlled immutable actor-bound evidence",()=>{
  for(const fragment of ["enable row level security","from public,anon,authenticated,service_role","security definer set search_path=''","current_user_is_admin()","auth.uid()","Coverage history is immutable","Coverage actor mismatch","pg_advisory_xact_lock","WRC12","WRC13"])
    expect(sql).toContain(fragment);
  expect(sql).not.toMatch(/grant execute|create policy/i);
});
it("fails closed on consumption, revisions and duplicate allocation attribution",()=>{
  for(const fragment of ["unattributed consumption","s.version=e.material_version","e.requirement_updated_at=r.updated_at","a.held_quantity=e.warehouse_held","existing_requirement+new.quantity::numeric","existing_warehouse+new.quantity::numeric","existing_state+new.quantity::numeric+coalesce(independent,0)","Independence overlaps verified coverage"])
    expect(sql).toContain(fragment);
});
it("changes no active Inventory formulas, stock or reservation writers",()=>{
  expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:inventory_|work_orders|work_order_items|work_order_material_reservation|test_calculation|finished_goods_project)/i);
  expect(sql).not.toMatch(/create or replace function/i);
  expect(sql).toContain("create or replace view public.work_order_requirement_attribution_current");
});
