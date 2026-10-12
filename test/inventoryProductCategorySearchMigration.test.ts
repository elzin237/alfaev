import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261012100000_add_inventory_product_category_search.sql",
), "utf8");

describe("Inventory Product Category search migration", () => {
  it("adds indexed case-insensitive partial Category matching to the trusted search", () => {
    expect(migration).toContain(
      "create index products_category_search_trgm_idx\n" +
        "  on public.products\n" +
        "  using gin (pg_catalog.lower(category) extensions.gin_trgm_ops);",
    );
    expect(migration).toContain(
      "or pg_catalog.lower(product.category) like v_contains_pattern escape '\\'",
    );
    expect(migration.match(/create index/g)).toHaveLength(1);
  });

  it("preserves the RPC signature, projection, literal matching, and deterministic ordering", () => {
    expect(migration).toContain(
      "create or replace function public.search_inventory_products(\n" +
        "  p_search text default null\n)",
    );
    expect(migration).toContain(
      "returns table (\n" +
        "  id uuid,\n" +
        "  serial_number text,\n" +
        "  name text,\n" +
        "  category text,\n" +
        "  brand_name text,\n" +
        "  product_kind text,\n" +
        "  is_active boolean,\n" +
        "  quantity bigint\n)",
    );
    expect(migration).toContain("pg_catalog.chr(92) || '%'");
    expect(migration).toContain("pg_catalog.chr(92) || '_'");
    expect(migration).toContain("order by product.serial_number, product.id;");
    expect(migration).not.toMatch(/where\s+product\.is_active|offset\s|limit\s/i);
  });

  it("preserves the active Admin-or-inventory.view boundary and hardened ACL", () => {
    expect(migration).toContain("public.current_user_is_admin()");
    expect(migration).toContain("public.has_permission('inventory.view')");
    expect(migration).toContain("using errcode = '42501'");
    expect(migration).toContain("stable\nsecurity definer\nset search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated;\n\ngrant execute\n" +
        "  on function public.search_inventory_products(text)\n" +
        "  to authenticated;",
    );
  });
});
