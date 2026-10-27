import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = "20261027110000_add_test_calculator_search_and_preview.sql";
const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
describe("Test Calculator trusted search/preview", () => {
  it("is migration 152 and preserves foundation 151", () => {
    expect(readdirSync("supabase/migrations").filter(p => p.endsWith(".sql")).sort().indexOf(file)).toBe(151);
    expect(createHash("sha256").update(readFileSync("supabase/migrations/20261027100000_add_test_calculator_foundation.sql")).digest("hex"))
      .toBe("e8d7b802a4b828cc685ddaaafc33371fa6d8c79ca76cf454fdcc80c6fb603684");
  });
  it("adds exactly two STABLE definer reads with empty search_path and explicit grants", () => {
    expect(sql.match(/create function public\.[a-z_]+/g)).toEqual([
      "create function public.search_test_calculator_products", "create function public.preview_test_calculation",
    ]);
    expect(sql.match(/stable security definer set search_path = ''/g)).toHaveLength(2);
    expect(sql.match(/grant execute[^;]+;/g)).toEqual([
      "grant execute on function public.search_test_calculator_products(text,integer) to authenticated;",
      "grant execute on function public.preview_test_calculation(jsonb) to authenticated;",
    ]);
    expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create table|create trigger|alter table|create policy|for update)\b/i);
  });
  it("requires active Test view/manage plus the complete relevant warehouse scope", () => {
    expect(sql.match(/public.current_active_user_profile_id\(\) is null/g)).toHaveLength(2);
    for (const key of ["test_calculator.view", "test_calculator.manage", "inventory.raw_materials.view", "inventory.customs.view", "inventory.finished_goods.view"])
      expect(sql).toContain(`public.has_permission('${key}')`);
    expect(sql).not.toContain("has_permission('pcb.edit')");
    expect(sql).toContain("product.is_active");
    expect(sql).toContain("product.product_kind = 'component' and all_access");
  });
  it("validates lossless bounded inputs and never accepts hold-exclusion context", () => {
    for (const text of ["jsonb_typeof(entry->'quantity') <> 'string'", "9223372036854775807::numeric",
      "key = any(ids)", "not between 1 and 100", "55000", "save_will_recalculate boolean"])
      expect(sql).toContain(text);
    expect(sql).not.toContain("p_calculation_id");
    expect(sql).not.toMatch(/double precision|\bfloat\b/);
    expect(sql).toContain("ordered.required::text");
    expect(sql).toContain("ordered.reservable::text");
  });
  it("uses FG-only linkage, existing Project demand and active Tests without mutating expiry", () => {
    expect(sql).toContain("public.is_calculator_finished_product");
    expect(sql).toContain("where not identity.finished or warehouse.code = 'finished_goods'");
    expect(sql).toContain("calculation.expires_at > read_at");
    expect(sql).toContain("public.calculate_open_project_commitments(identity.id)");
    expect(sql).toContain("when identity.finished then 0::numeric");
    expect(sql).toContain("pg_catalog.sum(free.quantity) - demand.quantity");
    expect(sql).toContain("public.production_warehouse_priority");
    expect(sql).not.toMatch(/submitted_payload|save_receipt|source_lot_id|inventory_source_allocations/);
  });
});
