import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql=readFileSync("supabase/migrations/20261026120000_correct_finished_goods_shortage_reconciliation.sql","utf8");
describe("150 FG shortage correction",()=>{
  it("uses authoritative classification and shared demand minus selected physical stock",()=>{
    expect(sql).toContain("public.is_calculator_finished_product(current_product_id)");
    expect(sql).toContain("array['10000000-0000-4000-8000-000000000002'::uuid]");
    expect(sql).toContain("-(eligible_physical_stock - outstanding_commitments)");
    expect(sql).toContain("commitment.outstanding_commitment > coalesce((");
    expect(sql).toContain("reservation.project_id = commitment.project_id");
  });
  it("reuses deferred queue infrastructure and denies direct execution",()=>{
    expect(sql).toContain("elsif tg_table_name = 'finished_goods_project_reservations'");
    expect(sql).toContain("after insert or update of reserved_quantity");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).not.toMatch(/grant execute|create table|disable trigger/i);
  });
  it("does not backfill or modify accounting, demand primitives or historical events",()=>{
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:inventory_balances|inventory_movements|finished_goods_project_reservations)\b/i);
    expect(sql).not.toMatch(/(?:update|delete from) public\.project_shortage_events\b/i);
    expect(sql).not.toContain("create or replace function public.calculate_");
    expect(sql).not.toMatch(/^select .*reconcile|^select .*initialize/im);
  });
});
