import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261022150000_queue_project_consumption_shortage_reconciliation.sql", "utf8",
);
const previous = readFileSync(
  "supabase/migrations/20261022100000_add_warehouse_aware_shortage_availability.sql", "utf8",
);
const functionBody = (text: string) => text.slice(
  text.indexOf("create or replace function public.queue_project_shortage_reconciliation()"),
  text.indexOf("$function$;", text.indexOf("create or replace function public.queue_project_shortage_reconciliation()")) + "$function$;".length,
);

describe("Project consumption shortage reconciliation migration", () => {
  it("preserves every existing helper branch exactly", () => {
    const branch = functionBody(sql).slice(
      functionBody(sql).indexOf("  elsif tg_table_name = 'inventory_movements' then"),
      functionBody(sql).indexOf("  elsif tg_table_name = 'project_product_components' then"),
    );
    expect(functionBody(sql).replace(branch, "")).toBe(functionBody(previous));
  });

  it("qualifies only negative Project-linked Work Order/PCB input insertions, from any warehouse", () => {
    const trigger = sql.slice(sql.indexOf("create trigger"));
    expect(trigger).toContain("after insert on public.inventory_movements");
    expect(trigger).toContain("new.project_id is not null");
    expect(trigger).toContain("new.quantity_delta < 0");
    expect(trigger).toContain("new.source_type in ('work_order', 'pcb_production_input')");
    expect(trigger).not.toContain("warehouse_id");
    expect(trigger).toContain("execute function public.queue_project_shortage_reconciliation()");
  });

  it("retains transaction/Product coalescing and the private security boundary", () => {
    expect(sql.match(/on conflict do nothing;/g)).toHaveLength(6);
    expect(sql).toContain("values (pg_catalog.txid_current(), new.product_id)");
    expect(sql).toContain("security definer\nset search_path = ''");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it("does not replace calculations, processing, permissions, or historical data", () => {
    expect(sql.match(/create or replace function/g)).toHaveLength(1);
    expect(sql.match(/create trigger/g)).toHaveLength(1);
    expect(sql).not.toMatch(/create\s+(table|index|policy)|alter table|\b(update|delete)\s+public\./i);
    expect(sql).not.toContain("initialize_project_shortage_alerts");
    expect(sql).not.toContain("create or replace function public.reconcile_project_shortages");
    expect(sql).not.toContain("create or replace function public.process_project_shortage");
    expect(sql).not.toContain("permission_definitions");
  });
});
