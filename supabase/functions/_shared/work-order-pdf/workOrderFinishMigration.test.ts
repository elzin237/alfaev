import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260930100000_add_atomic_work_order_finish.sql",
);

describe("Task 121 atomic Work Order Finish SQL", () => {
  it("composes preflight, Inventory, PDF, lifecycle, Project completion, audits, and ACLs atomically", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const deleteStart = sql.indexOf(
      "create or replace function public.delete_draft_work_order(",
    );
    const finishStart = sql.indexOf("create function public.finish_work_order(");
    expect(deleteStart).toBeGreaterThanOrEqual(0);
    expect(finishStart).toBeGreaterThan(deleteStart);
    const deleteFunctionSql = sql.slice(deleteStart, finishStart);
    expect(deleteFunctionSql).toContain(
      "from public.work_orders as work_order\n" +
        "  where work_order.id = p_work_order_id\n" +
        "  for update;",
    );
    expect(deleteFunctionSql).toContain(
      "from public.projects as project\n" +
        "    where project.id = current_work_order.project_id\n" +
        "    for update;",
    );
    expect(deleteFunctionSql.match(/current_work_order\.status <> 'draft'/g))
      .toHaveLength(2);
    expect(deleteFunctionSql.match(/current_work_order\.updated_at is distinct from p_expected_updated_at/g))
      .toHaveLength(2);
    expect(deleteFunctionSql).not.toMatch(/update public\.projects/i);
    expect(sql).toContain(
      "create function public.finish_work_order(\n" +
        "  p_work_order_id uuid,\n" +
        "  p_expected_updated_at timestamptz,\n" +
        "  p_pdf_storage_reference text,\n" +
        "  p_pdf_content_hash text default null",
    );
    expect(sql.match(/public\.preflight_finish_work_order\(/g)).toHaveLength(1);
    expect(sql).toContain("using errcode = 'IVB02'");
    expect(sql).toContain("from storage.objects as object");
    expect(sql).toContain("object.metadata->>'mimetype' = 'application/pdf'");
    expect(sql).toContain("from public.apply_inventory_delta(");
    expect(sql).toContain("p_movement_type => 'work_order'");
    expect(sql).toContain("p_source_type => 'work_order'");
    expect(sql).toContain("p_source_id => p_work_order_id");
    expect(sql).toContain("p_project_id => trusted_project_id");
    expect(sql).toContain("insert into public.work_order_pdfs as inserted");
    expect(sql).toContain("p_action_type => 'work_order.finished'");
    expect(sql).toContain("p_action_type => 'project.completed'");
    expect(sql).toContain("set status = 'completed'");
    expect(sql).toContain("language plpgsql\nvolatile\nsecurity definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "grant execute\n  on function public.finish_work_order(uuid, timestamptz, text, text)\n  to authenticated",
    );
    expect(sql).not.toMatch(/update public\.inventory_balances/i);
    expect(sql).not.toMatch(/insert into public\.inventory_movements/i);
    expect(sql).not.toMatch(
      /update public\.project_products|update public\.project_product_components/i,
    );
    expect(sql).not.toMatch(/storage\.(upload|download|remove)/i);
  });
});
