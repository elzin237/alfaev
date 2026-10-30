import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();
const sql=readFileSync("supabase/migrations/20261030160000_add_inventory_commitment_breakdown.sql","utf8");
it("is migration 176 and remains additive read-only, stable and authenticated-only",()=>{
  expect(files[175]).toBe("20261030160000_add_inventory_commitment_breakdown.sql");expect(sql).toMatch(/stable security definer set search_path=''/);expect(sql).toContain("current_active_user_profile_id()");expect(sql).toContain("from public,anon,authenticated,service_role");expect(sql).toContain("to authenticated");expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create table|create trigger)\b/i);
});
it("reuses authoritative membership, effective holds and live Draft allocations without Project coverage inference",()=>{expect(sql).toContain("search_inventory_products_by_warehouse");expect(sql).toContain("active_test_holds_at(observed_at");expect(sql).toContain("w.status='draft'");expect(sql).toContain("s.status='active'");expect(sql).toContain("calculate_open_project_commitments()");expect(sql).not.toContain("w.project_id");});
it("separates pagination totals and gates source metadata by module permissions",()=>{for(const key of ["projects.view","test_calculator.view","work_orders.view","restricted_remainder","visible_total","page_subtotal","visible_before_quantity","visible_after_quantity","ICB01"])expect(sql).toContain(key);expect(sql).toContain("p_limit>100");expect(sql).toContain("case when source_allowed then source_rows else '[]'::jsonb end");});
