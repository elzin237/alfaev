import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql=readFileSync("supabase/migrations/20261023120000_add_finished_goods_reservation_fulfillment.sql","utf8");
describe("private atomic Finished Goods fulfillment migration",()=>{
  it("preserves the frozen foundation and protection",()=>{
    for(const [file,hash] of [
      ["20261023100000_add_finished_goods_project_reservation_foundation.sql","2ebc25516dd399a1bf340ee38cb9c242ef0d82666d4c6f858516afb5c10cbcd8"],
      ["20261023110000_protect_finished_goods_hard_reservations.sql","f5e6f68a2df0692f0e2827baefe29d33d7da6b267a125e5b723eab46317e324b"],
    ]) expect(createHash("sha256").update(readFileSync(`supabase/migrations/${file}`)).digest("hex")).toBe(hash);
  });
  it("extends the existing consumption calculation/queue instead of creating another ledger",()=>{
    expect(sql).toContain("create or replace function public.calculate_open_project_commitments");
    expect(sql).toContain("create or replace function public.queue_project_shortage_reconciliation");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain("project_consumption_protect_finished_goods_reservations");
    expect(sql).toContain("'finished_goods_reservation_fulfillment'");
    expect(sql).not.toMatch(/create\s+table|update public.project_product_components|pcb_bom/i);
  });
  it("keeps fulfillment private with dedicated Project/FG authorization",()=>{
    for(const key of ["projects.view","projects.edit","inventory.finished_goods.view","inventory.finished_goods.reserve"])
      expect(sql).toContain(`public.has_permission('${key}')`);
    expect(sql).not.toMatch(/\bgrant\s+|disable trigger|row_security\s*=\s*off/i);
    expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(2);
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });
  it("uses actor-owned immutable receipts and a unique movement link",()=>{
    expect(sql).toContain("unique (inventory_movement_id)");
    expect(sql).toContain("event_type in ('reserved','released','fulfilled')");
    expect(sql.indexOf("receipt.actor_user_id <> actor_id")).toBeLessThan(sql.indexOf("receipt.event_type <> 'fulfilled'"));
    expect(sql).toContain("receipt.expected_version <> p_expected_version");
    expect(sql).toContain("pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0))");
  });
  it("uses existing physical/FIFO primitives without bypassing the debit guard",()=>{
    expect(sql).toContain("public.apply_inventory_delta_in_warehouse(");
    expect(sql.indexOf("set reserved_quantity = state.reserved_quantity - p_quantity")).toBeLessThan(sql.indexOf("select * into applied from"));
    expect(sql).toContain("state.version <> p_expected_version");
    expect(sql).toContain("p_quantity > state.reserved_quantity");
    expect(sql).not.toContain("create or replace function public.get_work_order_warehouse_source_allocation_plan");
    expect(sql).not.toContain("create or replace function public.reconcile_project_shortages");
  });
  it("checks reciprocal provenance at commit and appends one audited fulfillment",()=>{
    expect(sql.match(/deferrable initially deferred/g)).toHaveLength(2);
    expect(sql).toContain("allocated <> receipt.requested_quantity::numeric");
    expect(sql).toContain("movement.project_id is distinct from receipt.project_id");
    expect(sql).toContain("movement.actor_user_id is distinct from receipt.actor_user_id");
    expect(sql).toContain("p_action_type=>'finished_goods_reservation.fulfilled'");
    expect(sql).not.toMatch(/update public.inventory_movements|delete from public\./i);
  });
});
