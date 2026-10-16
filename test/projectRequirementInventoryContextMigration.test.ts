import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261016100000_add_project_requirement_inventory_context.sql",
), "utf8");

describe("Project requirement Inventory context migration", () => {
  it("extends the existing single Project planning read with only required Inventory context", () => {
    expect(migration).toContain("drop function public.get_project_planning(uuid);");
    expect(migration).toContain("create function public.get_project_planning(p_project_id uuid)");
    for (const field of [
      "required_quantity text", "category text", "brand_name text",
      "physical_quantity text", "committed_to_projects text",
      "available_after_commitments text",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("from public.calculate_open_project_commitments() as commitment");
    expect(migration).toContain("balance.quantity::numeric -");
    expect(migration).toContain("component.required_quantity::text");
    expect(migration).not.toMatch(/supplier|movement\.actor|audit_log|user_profile/i);
    expect(migration.match(/create function public\.get_project_planning/g)).toHaveLength(1);
  });

  it("preserves Project authorization and reveals Inventory context only under Inventory authority", () => {
    expect(migration).toContain("public.current_user_is_admin()\n    or public.has_permission('projects.view')");
    expect(migration).toContain("can_view_inventory := public.current_user_is_admin()\n    or public.has_permission('inventory.view');");
    expect(migration).toContain("case when can_view_inventory then product.category else null::text end");
    expect(migration).toContain("case when can_view_inventory then balance.quantity::text else null::text end");
    expect(migration.match(
      /case when can_view_inventory and product\.id is not null then/g,
    )).toHaveLength(2);
    expect(migration).toContain("using errcode = '42501'");
  });

  it("keeps deterministic ordering and hardened function metadata and ACL", () => {
    expect(migration).toContain("stable\nsecurity definer\nset search_path = ''");
    expect(migration).toContain(
      "pg_catalog.lower(project_product.name),\n" +
        "    project_product.name,\n" +
        "    project_product.id,\n" +
        "    product.serial_number nulls first,\n" +
        "    component.id;",
    );
    expect(migration).toContain(
      "from public, anon, authenticated;\n\n" +
        "grant execute\n" +
        "  on function public.get_project_planning(uuid)\n" +
        "  to authenticated;",
    );
    expect(migration).not.toMatch(/create index|alter policy|create policy|grant select/i);
  });
});
