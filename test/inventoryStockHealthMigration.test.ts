import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const path="supabase/migrations/20261028110000_add_authoritative_stock_health_reads.sql";
const sql=readFileSync(path,"utf8");
it("preserves the complete 1–159 migration baseline",()=>{
  const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();
  expect(files[159]).toBe("20261028110000_add_authoritative_stock_health_reads.sql");
  const hash=createHash("sha256");for(const f of files.slice(0,159))hash.update(f+"\0").update(readFileSync(`supabase/migrations/${f}`));
  expect(hash.digest("hex")).toBe("424c84acd15e4d443277f637273bf3f9abfffc79c53ab83884d914c84734866b");
});
it("shares exactly one physical classifier and authoritative membership projection",()=>{
  expect(sql.match(/create function public.inventory_stock_health_status\(/g)).toHaveLength(1);
  expect(sql).toContain("public.search_inventory_products_by_warehouse(p_warehouse_id,p_search)");
  expect(sql.match(/from public.inventory_stock_health_rows\(/g)).toHaveLength(1);
  expect(sql).toContain("cross join lateral public.inventory_stock_health_rows(warehouse.id,null,true)");
  expect(sql).not.toMatch(/calculate_open_project_commitments|finished_goods_project_reservations|test_calculation_holds/);
});
it("grants only the two public read contracts and keeps helpers private",()=>{
  expect(sql.match(/grant execute/g)).toHaveLength(2);
  expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(2);
  expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(4);
  expect(sql).toContain("public.current_active_user_profile_id() is null");
  expect(sql).toContain("public.has_permission('dashboard.view')");
  expect(sql).not.toMatch(/create policy|grant .*on table|grant .*to service_role/i);
});
it("materializes one authorized snapshot for counts and bounded critical rows",()=>{
  expect(sql).toContain("with authorized as materialized");expect(sql).toContain("health as materialized");
  expect(sql).toContain("p_critical_limit > 100");expect(sql).toContain("p_limit > 200");
  expect(sql).toContain("'NOT_CONFIGURED'");expect(sql).toContain("'OUT_OF_STOCK'");
  expect(sql).toContain("'LOW_STOCK'");expect(sql).toContain("'HEALTHY'");
  expect(sql).toContain("health.product_id");expect(sql).not.toMatch(/\bsum\s*\(/i);
});
it("returns text quantities and versions without modifying any table or existing RPC",()=>{
  expect(sql).toContain("health.physical_quantity::text");expect(sql).toContain("health.minimum_quantity::text");
  expect(sql).toContain("health.configuration_version::text");expect(sql).toContain("summary.total::text");
  expect(sql).not.toMatch(/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b|create or replace|create trigger|alter table/i);
});
