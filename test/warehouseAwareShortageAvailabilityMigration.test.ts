import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20261022100000_add_warehouse_aware_shortage_availability.sql";
const sql = readFileSync(path, "utf8");

describe("warehouse-aware Project availability migration", () => {
  it("uses exactly Raw Materials plus Customs for eligible physical stock", () => {
    expect(sql).toContain("pg_catalog.sum(balance.quantity::numeric)");
    expect(sql).toContain("'10000000-0000-4000-8000-000000000001'::uuid");
    expect(sql).toContain("'10000000-0000-4000-8000-000000000003'::uuid");
    expect(sql).not.toMatch(
      /warehouse_id in \([\s\S]{0,250}'10000000-0000-4000-8000-000000000002'::uuid/,
    );
    expect(sql).toContain("eligible_physical_stock - outstanding_commitments");
  });

  it("preserves Project commitment semantics across actual source warehouses", () => {
    expect(sql).toContain("create or replace function public.calculate_open_project_commitments(");
    expect(sql).toContain("movement.source_type in ('work_order', 'pcb_production_input')");
    const calculation = sql.slice(
      sql.indexOf("create or replace function public.calculate_open_project_commitments("),
      sql.indexOf("revoke all privileges\n  on function public.calculate_open_project_commitments"),
    );
    expect(calculation).not.toContain("movement.warehouse_id");
    expect(calculation).toContain("project.status in ('planned', 'in_progress', 'on_hold')");
    expect(calculation).toContain("greatest(");
  });

  it("queues only eligible warehouse balance changes and keeps final-state reconciliation", () => {
    expect(sql).toContain("create or replace function public.queue_project_shortage_reconciliation()");
    expect(sql).toContain("new.warehouse_id in (");
    expect(sql).toContain("old.warehouse_id in (");
    expect(sql).not.toContain("create constraint trigger");
    expect(sql).not.toContain("select public.initialize_project_shortage_alerts()");
    expect(sql).not.toContain("existing shortage detected at enablement');\nselect");
  });

  it("serializes deferred reconciliation without inverting Product and balance locks", () => {
    const reconciliation = sql.slice(
      sql.indexOf("create or replace function public.reconcile_project_shortages_for_products("),
      sql.indexOf("revoke all privileges\n  on function public.reconcile_project_shortages_for_products"),
    );
    expect(reconciliation).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(reconciliation).toContain("'project-shortage-reconciliation:' || current_product_id::text");
    expect(reconciliation).not.toMatch(
      /from public\.products as product[\s\S]{0,120}for update/,
    );
  });

  it("does not add schema, indexes, permissions, grants, or browser table access", () => {
    expect(sql).not.toMatch(/create\s+(?:table|index|policy)/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.permission_definitions/i);
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)/i);
    expect(sql).not.toContain("grant execute on function public.reconcile_project_shortages");
    expect(sql).not.toContain("grant execute on function public.queue_project_shortage");
  });

  it("requires both eligible warehouse views for combined stock projections", () => {
    expect(sql.match(/public\.has_permission\('inventory\.raw_materials\.view'\)/g))
      .toHaveLength(3);
    expect(sql.match(/public\.has_permission\('inventory\.customs\.view'\)/g))
      .toHaveLength(3);
    expect(sql).toContain("grant execute\n  on function public.get_project_planning(uuid)\n  to authenticated");
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });
});
