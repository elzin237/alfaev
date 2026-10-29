import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = "supabase/migrations/";
const sql = readFileSync(`${directory}20261028120000_exclude_calculator_outputs_from_raw_inventory.sql`, "utf8");
const listing = readFileSync(`${directory}20261022140000_fix_warehouse_product_visibility_and_calculator_stock.sql`, "utf8")
  .split("-- Calculator output stock means Finished Goods")[0]!;
const details = readFileSync(`${directory}20261021140000_add_warehouse_permissions_and_operations.sql`, "utf8")
  .split("create function public.get_inventory_product_by_warehouse(")[1]!.split("create function public.list_active_inventory_source_choices_by_warehouse(")[0]!;

describe("Calculator output warehouse visibility correction", () => {
  it("preserves all 160 prior migrations byte-for-byte", () => {
    const files = readdirSync(directory).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
    expect(files[160]).toBe("20261028120000_exclude_calculator_outputs_from_raw_inventory.sql");
    const hash = createHash("sha256");
    for (const file of files.slice(0, 160)) hash.update(file + "\0").update(readFileSync(directory + file));
    expect(hash.digest("hex")).toBe("1e42fd413052f7585d35d0a277e3a2a1c1ef3a977f8be31db64f6188b0e1dd97");
  });
  it("patches exactly one known fragment per read function and fails closed on definition drift", () => {
    const old = [...sql.matchAll(/old_fragment := \$old\$([\s\S]*?)\$old\$;/g)].map(match => match[1]!);
    const replacement = [...sql.matchAll(/new_fragment := \$new\$([\s\S]*?)\$new\$;/g)].map(match => match[1]!);
    expect(old).toHaveLength(2); expect(replacement).toHaveLength(2);
    for (const [index, source] of [listing, details].entries()) expect(source.split(old[index]!).length - 1).toBe(1);
    expect(sql.match(/<> pg_catalog.length\(old_fragment\)/g)).toHaveLength(2);
    const corrected = listing.replace(old[0]!, replacement[0]!);
    expect(corrected).toContain("and not exists (");
    expect(corrected).toContain("raw_output.output_product_id = product.id");
    expect(corrected).toContain("card.output_product_id = product.id");
    expect(corrected).toContain("balance.quantity > 0");
    expect(corrected).toContain("movement.warehouse_id = p_warehouse_id");
    expect(corrected).not.toContain("card.is_active");
    expect(corrected).not.toContain("where product.is_active");
    const detail = details.replace(old[1]!, replacement[1]!);
    expect(detail.indexOf("public.has_permission(required_permission)")).toBeLessThan(detail.indexOf("raw_output.output_product_id = p_product_id"));
    expect(replacement[1]).toContain("using errcode = 'P0002'");
  });
  it("changes only the two trusted reads, preserving ACLs and every accounting path", () => {
    expect([...sql.matchAll(/'public\.([^']+)'::regprocedure/g)].map(match => match[1])).toEqual([
      "search_inventory_products_by_warehouse(uuid,text)", "get_inventory_product_by_warehouse(uuid,uuid)",
    ]);
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|truncate|alter table|create table|create trigger|grant |revoke )/i);
    expect(sql).not.toMatch(/product_kind\s*=|card\.is_active|balance\.quantity\s*=/);
    for (const source of [listing, details]) expect(source).toContain("security definer\nset search_path = ''");
  });
  it("propagates canonical membership to minimums, health, Dashboard and Test reads without extra frontend filters", () => {
    for (const filename of ["20261028100000_add_inventory_stock_minimum_configuration.sql",
      "20261028110000_add_authoritative_stock_health_reads.sql", "20261027160000_add_expiry_aware_inventory_test_commitments.sql"])
      expect(readFileSync(directory + filename, "utf8")).toContain("public.search_inventory_products_by_warehouse(");
    expect(readFileSync(`${directory}20261028110000_add_authoritative_stock_health_reads.sql`, "utf8"))
      .toContain("cross join lateral public.inventory_stock_health_rows(warehouse.id,null,true)");
  });
});
