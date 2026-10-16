import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261016110000_add_pcb_work_order_source_to_project_material_usage.sql",
), "utf8");

describe("Project Material Usage Work Order source migration", () => {
  it("keeps one narrow projection and resolves PCB Work Order labels with a legacy Card fallback", () => {
    expect(migration).toContain("drop function public.list_project_material_usage(uuid);");
    expect(migration).toContain("source_work_order_id uuid");
    expect(migration).toContain(
      "production_run.work_order_id as source_work_order_id",
    );
    expect(migration).toContain(
      "left join public.work_orders as production_work_order\n" +
        "      on production_work_order.id = production_run.work_order_id",
    );
    expect(migration).toContain(
      "coalesce(\n" +
        "        production_work_order.work_order_number,\n" +
        "        pcb_card.name\n" +
        "      ) as source_label",
    );
    expect(migration).not.toContain("pg_catalog.coalesce(");
    expect(migration).not.toMatch(/user_profiles|audit_logs|supplier|before_data|after_data/i);
  });

  it("preserves Project authorization, physical-source qualification, ordering, and function hardening", () => {
    expect(migration).toContain(
      "public.current_user_is_admin()\n" +
        "      or public.has_permission('projects.view')",
    );
    expect(migration).toContain("movement.movement_type = 'work_order'");
    expect(migration).toContain("work_order.status = 'finished'");
    expect(migration).toContain("movement.movement_type = 'pcb_production_input'");
    expect(migration).toContain("production_run.status = 'completed'");
    expect(migration).toContain("movement.quantity_delta < 0");
    expect(migration).toContain(
      "order by usage.consumed_at desc, usage.movement_id desc;",
    );
    expect(migration).toContain("stable\nsecurity definer\nset search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated;\n\n" +
        "grant execute\n" +
        "  on function public.list_project_material_usage(uuid)\n" +
        "  to authenticated;",
    );
    expect(migration).not.toMatch(/grant select|create policy|alter policy/i);
  });
});
