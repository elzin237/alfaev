import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261022140000_fix_warehouse_product_visibility_and_calculator_stock.sql", "utf8");
const functions = sql.split("create or replace function public.").slice(1);

describe("Task 001J warehouse visibility migration", () => {
  it("replaces exactly the three existing read functions without data/schema/security mutations", () => {
    expect(functions.map(f => f.slice(0, f.indexOf("(")))).toEqual([
      "search_inventory_products_by_warehouse", "list_pcb_cards", "get_pcb_bom_editor",
    ]);
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|alter table|create table|create index|grant |revoke |drop )/i);
    for (const fn of functions) expect(fn).toMatch(/language plpgsql\nstable\nsecurity definer\nset search_path = ''/);
  });
  it("ANDs membership with the whole search expression and keeps all search/order contracts", () => {
    const listing = functions[0]!;
    expect(listing).toContain("where (\n    normalized_search is null");
    expect(listing).toContain("  )\n  and (");
    for (const field of ["product.name", "product.category", "product.serial_number", "relationship.catalog_number"]) expect(listing).toContain(field);
    expect(listing).toContain("order by product.serial_number, product.id");
    expect(listing).toContain("card.output_product_id = product.id");
    expect(listing).toContain("balance.quantity > 0");
    expect(listing).toContain("movement.warehouse_id = p_warehouse_id");
    expect(listing).not.toContain("card.is_active");
    expect(listing).not.toContain("where product.is_active");
    expect(listing).toContain("public.current_active_user_profile_id()");
    expect(listing).toContain("public.has_permission(required_permission)");
  });
  it("switches only Calculator output joins to Finished Goods and preserves Raw BOM inputs", () => {
    expect(functions[1]).toContain("balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid");
    expect(functions[2]).toContain("output_balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid");
    expect(functions[2]).toContain("input_balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid");
    expect(functions[1]).toContain("current_stock bigint");
    expect(functions[2]).toContain("output_current_stock text");
    expect(functions[1]).toContain("public.has_permission('pcb.view')");
    expect(functions[2]).toContain("public.has_permission('pcb.view')");
  });
});
