import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261016120000_aggregate_project_material_usage_by_product.sql",
), "utf8");

describe("Project Material Usage aggregate migration", () => {
  it("returns exactly one bigint-safe aggregate row per Product", () => {
    expect(migration).toContain("drop function public.list_project_material_usage(uuid);");
    expect(migration).toContain(
      "returns table (\n" +
        "  product_id uuid,\n" +
        "  serial_number text,\n" +
        "  product_name text,\n" +
        "  quantity text\n" +
        ")",
    );
    expect(migration).toContain("0::numeric - movement.quantity_delta::numeric as quantity");
    expect(migration).toContain("pg_catalog.sum(usage.quantity) as quantity");
    expect(migration).toContain("group by usage.product_id");
    expect(migration).toContain("usage.quantity::text as quantity");
    expect(migration).toContain("order by product.serial_number asc, product.id asc;");
    for (const field of [
      "movement_id uuid", "source_type text", "source_id uuid",
      "source_work_order_id uuid", "source_label text", "consumed_at timestamptz",
    ]) expect(migration).not.toContain(field);
  });

  it("preserves authoritative physical-consumption qualification and security", () => {
    expect(migration).toContain("movement.movement_type = 'work_order'");
    expect(migration).toContain("movement.source_type = 'work_order'");
    expect(migration).toContain("work_order.status = 'finished'");
    expect(migration).toContain("movement.movement_type = 'pcb_production_input'");
    expect(migration).toContain("movement.source_type = 'pcb_production_input'");
    expect(migration).toContain("production_run.status = 'completed'");
    expect(migration.match(/movement\.quantity_delta < 0/g)).toHaveLength(2);
    expect(migration).toContain("union all");
    expect(migration).not.toMatch(/manual_(add|remove|adjustment)|correction_reversal|pcb_production_output/);

    expect(migration).toContain("public.current_user_is_admin()");
    expect(migration).toContain("public.has_permission('projects.view')");
    for (const permission of ["inventory.view", "work_orders.view", "pcb.view"]) {
      expect(migration).not.toContain(`public.has_permission('${permission}')`);
    }
    expect(migration).toContain("stable\nsecurity definer\nset search_path = ''");
    expect(migration).toContain("from public, anon, authenticated;");
    expect(migration).toContain("to authenticated;");
    expect(migration).not.toMatch(/grant select|create policy|alter policy/i);
  });
});
