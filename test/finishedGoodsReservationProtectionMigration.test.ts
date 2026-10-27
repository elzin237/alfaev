import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261023110000_protect_finished_goods_hard_reservations.sql", "utf8");
const foundation = readFileSync("supabase/migrations/20261023100000_add_finished_goods_project_reservation_foundation.sql");

describe("Finished Goods hard reservation protection", () => {
  it("preserves the exact reviewed foundation and does not enable mutation APIs", () => {
    expect(createHash("sha256").update(foundation).digest("hex"))
      .toBe("2ebc25516dd399a1bf340ee38cb9c242ef0d82666d4c6f858516afb5c10cbcd8");
    expect(sql).not.toMatch(/\bgrant\s+/i);
    expect(sql).toContain("public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid)");
    expect(sql).toContain("public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid)");
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });
  it("protects all real physical debits at the locked FG balance boundary", () => {
    expect(sql).toContain("before update of quantity on public.inventory_balances");
    expect(sql).toContain("and new.quantity < old.quantity");
    expect(sql).toContain("if new.quantity::numeric < reserved then");
    expect(sql).toContain("using errcode = 'IVB02'");
    expect(sql).toContain("language plpgsql volatile security definer set search_path = ''");
    expect(sql).not.toContain("p_fulfillment");
  });
  it("caps FG FIFO allocation after Product/balance locks without changing source priority", () => {
    const allocation=sql.slice(sql.indexOf("create or replace function public.get_work_order_warehouse_source_allocation_plan"));
    expect(allocation.indexOf("perform product.id")).toBeLessThan(allocation.indexOf("perform balance.product_id"));
    expect(allocation.indexOf("perform balance.product_id")).toBeLessThan(allocation.indexOf("perform lot.id"));
    expect(sql).toContain("greatest(coalesce(available_fg,0::numeric) - prefix.before_in_warehouse,0::numeric)");
    expect(sql).toContain("order by fifo.priority, fifo.received_at, fifo.id");
    expect(sql).toContain("allocated_quantity bigint, received_at timestamptz");
    expect(sql).toContain("create or replace function public.get_production_eligible_quantity");
  });
  it("guards explicit demand changes and qualifying consumption, without redefining commitments", () => {
    expect(sql).toContain("after insert or update or delete on public.project_product_components");
    expect(sql).toContain("after update or delete on public.project_products");
    expect(sql).toContain("new.source_type in ('work_order','pcb_production_input')");
    expect(sql).toContain("state.reserved_quantity::numeric > coalesce");
    expect(sql).not.toContain("create or replace function public.calculate_open_project_commitments");
    expect(sql).not.toContain("update public.project_product_components");
  });
  it("releases on cancellation atomically and requires resolution before completion", () => {
    expect(sql).toContain("new.status = 'completed' and exists");
    expect(sql).toContain("using errcode = 'FGR08'");
    expect(sql).toContain("if new.status <> 'cancelled' then return new");
    expect(sql).toContain("public.has_permission('projects.archive')");
    expect(sql).toContain("current_active_user_profile_id() is distinct from actor_id");
    expect(sql.indexOf("current_active_user_profile_id() is distinct from actor_id"))
      .toBeGreaterThan(sql.indexOf("perform r.id from public.finished_goods_project_reservations"));
    expect(sql).toContain("version = state.version + 1");
    expect(sql).toContain("'release_reason','project_cancelled'");
    expect(sql).toContain("insert into public.finished_goods_project_reservation_events");
  });
  it("adds no new table/index or historical backfill and fails closed on invalid starting state", () => {
    expect(sql).not.toMatch(/create\s+(?:table|index)|alter table|disable trigger/i);
    expect(sql).toContain("Existing Finished Goods reservations violate stock or demand bounds");
    expect(sql.match(/security definer/g)).toHaveLength(3);
    expect(sql.match(/create trigger/g)).toHaveLength(5);
  });
});
