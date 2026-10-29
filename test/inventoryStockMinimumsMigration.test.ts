import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
const sql=readFileSync("supabase/migrations/20261028100000_add_inventory_stock_minimum_configuration.sql","utf8");
it("preserves all 158 approved migrations",()=>{
  const hash=createHash("sha256");for(const f of readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort().slice(0,158))hash.update(f+"\0").update(readFileSync(`supabase/migrations/${f}`));
  expect(hash.digest("hex")).toBe("35c896ccf7bec439c74bdf167b2369b55583acb6bcf75534fa46f86ecbda16db");
});
it("adds only a private positive-bigint configuration table and one narrow RPC",()=>{
  expect(sql.match(/create table public\./g)).toHaveLength(1);expect(sql.match(/create function public\./g)).toHaveLength(1);
  expect(sql).toContain("primary key (product_id, warehouse_id)");expect(sql).toContain("minimum_quantity is null or minimum_quantity > 0");
  expect(sql).toContain("alter table public.inventory_stock_minimums enable row level security");
  expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(2);
  expect(sql).toContain("grant execute on function public.set_inventory_stock_minimum(uuid,uuid,text,text) to authenticated");
  expect(sql).not.toMatch(/create policy|grant .* on table|grant .* to service_role/i);
});
it("locks Product before configuration and revalidates active actor and warehouse membership",()=>{
  expect(sql).toContain("security definer set search_path = ''");expect(sql).toContain("public.has_permission('inventory.products.edit')");
  expect(sql).toContain("public.inventory_warehouse_permission_key(p_warehouse_id, 'view')");
  expect(sql).toContain("public.search_inventory_products_by_warehouse(p_warehouse_id, null)");
  expect(sql.indexOf("product.id = p_product_id for update")).toBeLessThan(sql.indexOf("select setting.*"));
  expect(sql).toContain("expected_value is distinct from current_setting_row.version");expect(sql).toContain("errcode = 'ISM01'");
});
it("writes only configuration, with exact decimal-string responses and no accounting side effects",()=>{
  const targets=[...sql.matchAll(/(?:insert into|update) public\.([a-z_]+)/g)].map(m=>m[1]);
  expect(targets).toEqual(["inventory_stock_minimums","inventory_stock_minimums"]);
  expect(sql).toContain("setting.minimum_quantity::text");expect(sql).toContain("setting.version::text");
  expect(sql).not.toMatch(/\bdelete\s+from|\btruncate\b|append_audit_log|reconcile_project|nextval|create trigger|create policy/i);
});
