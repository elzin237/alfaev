import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const path = resolve(process.cwd(),
  "supabase/migrations/20261021160000_add_warehouse_aware_production.sql");
const sql = readFileSync(path, "utf8");

describe("warehouse-aware production migration", () => {
  it("uses the exact approved production priority and warehouse-aware FIFO", () => {
    expect(sql).toContain("when '10000000-0000-4000-8000-000000000001'::uuid then 1");
    expect(sql).toContain("when '10000000-0000-4000-8000-000000000003'::uuid then 2");
    expect(sql).toContain("when '10000000-0000-4000-8000-000000000002'::uuid then 3");
    expect(sql).toContain("lot.received_at, lot.id");
    expect(sql).toContain("plan.product_id::text || ':' || plan.warehouse_id::text");
  });

  it("keeps production stock trusted and does not grant warehouse adjustment", () => {
    expect(sql).toContain("public.has_permission('pcb.produce')");
    expect(sql).toContain("These replacements preserve signatures, grants, and wrappers");
    expect(sql).not.toContain("public.has_permission('inventory.raw_materials.adjust')");
    expect(sql).not.toContain("public.has_permission('inventory.customs.adjust')");
    expect(sql).not.toContain("public.has_permission('inventory.finished_goods.adjust')");
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });

  it("credits only positive PCB output to Finished Goods as internal production", () => {
    expect(sql).toContain("p_warehouse_id => '10000000-0000-4000-8000-000000000002'::uuid");
    expect(sql).toContain("p_inventory_source_kind => 'internal_production'");
    expect(sql).toContain("'public.finish_pcb_work_order_internal(uuid,timestamp with time zone,text,text,text)'");
    expect(sql).not.toContain("p_inventory_source_kind => 'internal_production'\n      p_warehouse_id => '10000000-0000-4000-8000-000000000001'");
  });

  it("preserves Project shortage semantics for Task 001G", () => {
    expect(sql).not.toContain("reconcile_project_shortages_for_products");
    expect(sql).not.toContain("calculate_open_project_commitments");
    expect(sql).not.toContain("project_shortage_episodes");
  });

  it("keeps public Finish signatures and limits Finished reads to view authorization", () => {
    expect(sql).not.toMatch(/create\s+(or replace\s+)?function\s+public\.finish_work_order\s*\(/i);
    expect(sql).toContain("public.has_permission('work_orders.view')");
    expect(sql).toContain("warehouse_code text");
    expect(sql).toContain("warehouse_name text");
  });

  it("keeps both PDF snapshots aligned with the warehouse-aware Finish fingerprint", () => {
    expect(sql).toContain(
      "'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone)'",
    );
    expect(sql).toContain(
      "'public.get_work_order_pdf_snapshot(uuid,timestamp with time zone,text)'",
    );
    expect(sql).toContain(
      "'public.get_work_order_warehouse_source_allocation_plan('",
    );
    expect(sql).toContain(
      "plan.product_id::text || ':' || plan.warehouse_id::text || ':'",
    );
    expect(sql).toContain(
      "'|' order by plan.product_id, plan.warehouse_priority,",
    );
    expect(sql).toContain("material.warehouse_priority nulls first");
  });

  it("rejects Project selection for new PCB requests after the historical replay branch", () => {
    const replay = sql.indexOf("if found then");
    const rejection = sql.indexOf("New PCB production Work Orders do not accept a Project");
    expect(replay).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(replay);
  });
});
