import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "../app/auth/permissions";

const sql = readFileSync("supabase/migrations/20261023100000_add_finished_goods_project_reservation_foundation.sql", "utf8");

describe("Finished Goods reservation non-executable foundation", () => {
  it("uses explicit existing Project/Product demand rather than inferred output names/BOMs", () => {
    expect(sql).toContain("public.calculate_open_project_commitments(p_product_id)");
    expect(sql).toContain("commitment.project_id = p_project_id");
    expect(sql).toContain("card.output_product_id = product.id");
    expect(sql).not.toMatch(/lower\(|category\s*=|serial_number|pcb_bom_items/i);
  });
  it("adds only a dedicated capability with no automatic grants", () => {
    expect(PERMISSION_KEYS).toContain("inventory.finished_goods.reserve");
    expect(sql).not.toMatch(/insert into public.user_permissions/i);
    expect(sql).toContain("public.has_permission('projects.edit')");
    expect(sql).toContain("public.has_permission('projects.view')");
    expect(sql).toContain("public.has_permission('inventory.finished_goods.view')");
    expect(sql).not.toContain("public.has_permission('inventory.finished_goods.adjust')");
  });
  it("keeps all mutation routines private even to authenticated Admins and service_role", () => {
    expect(sql).toContain("revoke all on function public.change_finished_goods_project_reservation");
    expect(sql).toContain("revoke all on function public.reserve_finished_goods_for_project");
    expect(sql.match(/grant execute[\s\S]*?;/g)).toEqual([
      expect.stringContaining("public.list_project_finished_goods_reservations(uuid)"),
    ]);
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });
  it("serializes request replay and Product stock, checks exact versions and bounds", () => {
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("receipt.actor_user_id <> actor_id");
    expect(sql.indexOf("receipt.actor_user_id <> actor_id")).toBeLessThan(sql.indexOf("receipt.project_id <> p_project_id"));
    expect(sql).toContain("coalesce(current_state.version, 0) <> p_expected_version");
    expect(sql).toContain("total_reserved + p_quantity::numeric > physical_quantity::numeric");
    expect(sql).toContain("before_quantity::numeric + p_quantity::numeric > demand");
    expect(sql).toContain("000000000002'::uuid for update");
    expect(sql).toContain("unique (project_id, product_id)");
  });
  it("keeps history immutable, tables private and the fixed warehouse explicit", () => {
    expect(sql.match(/enable row level security/g)).toHaveLength(2);
    expect(sql).toContain("Reservation history is immutable");
    expect(sql).toContain("before update or delete on public.finished_goods_project_reservation_events");
    expect(sql).toContain("request_id uuid not null unique");
    expect(sql).toContain("check (warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)");
    expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(5);
  });
  it("does not change Inventory, demand, existing lifecycle or historical records", () => {
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:inventory_|project_product|projects\b|work_order|pcb_production)/i);
    expect(sql).not.toContain("create or replace function");
    expect(sql).not.toContain("grant all");
  });
});
