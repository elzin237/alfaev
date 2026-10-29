import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const directory = "supabase/migrations/";
const sql = readFileSync(directory + "20261028130000_add_work_order_material_availability.sql", "utf8");

it("preserves migrations 1–161 byte-for-byte", () => {
  const files = readdirSync(directory).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
  expect(files[161]).toBe("20261028130000_add_work_order_material_availability.sql");
  const hash = createHash("sha256");
  for (const file of files.slice(0, 161)) hash.update(file + "\0").update(readFileSync(directory + file));
  expect(hash.digest("hex")).toBe("1fcc95d91a66691fba8112fc66b3b13f0d1c1aa557ef26fe69f6ff94dc44ec4f");
});

it("exposes only the active-profile Work Order detail-authorized read", () => {
  expect(sql).toContain("auth.uid() is null or public.current_active_user_profile_id() is null");
  expect(sql).toContain("public.has_permission('work_orders.view')");
  expect(sql).not.toMatch(/has_permission\('inventory|has_permission\('work_orders.finish/);
  expect(sql.match(/grant execute/g)).toHaveLength(1);
  expect(sql.match(/security definer/g)).toHaveLength(1);
  expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(3);
  expect(sql).toContain("language plpgsql stable security definer set search_path = ''");
});

it("uses one STABLE snapshot and expiry instant, without fresh-snapshot wrappers", () => {
  const rpc = sql.split("create function public.get_work_order_material_availability")[1]!;
  expect(rpc).toContain("pg_catalog.statement_timestamp()");
  expect(rpc).toContain("get_production_free_warehouse_quantity_at(");
  expect(rpc).not.toMatch(/clock_timestamp|get_production_eligible_quantity\(|get_production_free_warehouse_quantity\(/);
  expect(sql).toContain("calculation.expires_at > p_as_of");
  expect(sql).toContain("returns numeric language sql stable security invoker set search_path = ''");
});

it("preserves production wall-clock semantics and shares its capacity arithmetic", () => {
  expect(sql).toContain("returns numeric language sql volatile security invoker");
  expect(sql).toContain("p_product_id,p_warehouse_id,pg_catalog.clock_timestamp()");
  expect(sql).toContain("public.finished_goods_project_reservations state");
  expect(sql).toContain("public.test_calculation_holds hold");
  expect(sql).toContain("public.is_calculator_finished_product(product.id)");
  expect(sql).not.toMatch(/calculate_open_project_commitments|project_product_components/);
  expect(sql.match(/create or replace function/g)).toHaveLength(1);
});

it("aggregates origins before text calculation, retains empty Draft identity and fails closed", () => {
  expect(sql).toContain("pg_catalog.sum(item.quantity::numeric)::bigint");
  expect(sql).toContain("group by item.product_id");
  for (const field of ["required_quantity::text", "eligible_quantity::text", "'missing_quantity'", "'has_shortage'"])
    expect(sql).toContain(field);
  for (const code of ["42501", "22023", "P0002", "WOR02", "IVB01"])
    expect(sql).toContain(`errcode = '${code}'`);
  expect(sql).toContain("'[]'::jsonb");
  expect(sql).toContain("'work_order_id',current_order.id");
  expect(sql).not.toMatch(/for update|for share|\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b|create trigger|alter table|create policy/i);
});
