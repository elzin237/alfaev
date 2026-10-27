import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261023130000_add_project_finished_goods_reservation_context.sql", "utf8");
describe("trusted Project Finished Goods reservation context", () => {
  it("preserves frozen reservation migrations", () => {
    for (const [file, hash] of [
      ["20261023100000_add_finished_goods_project_reservation_foundation.sql", "2ebc25516dd399a1bf340ee38cb9c242ef0d82666d4c6f858516afb5c10cbcd8"],
      ["20261023110000_protect_finished_goods_hard_reservations.sql", "f5e6f68a2df0692f0e2827baefe29d33d7da6b267a125e5b723eab46317e324b"],
      ["20261023120000_add_finished_goods_reservation_fulfillment.sql", "3504ef24ca9f3863934d782c43780f32153b610c037de02330e26291d4b87173"],
    ]) expect(createHash("sha256").update(readFileSync(`supabase/migrations/${file}`)).digest("hex")).toBe(hash);
  });
  it("grants only the stable narrow read and keeps canonical calculation helpers private", () => {
    expect(sql.match(/grant execute[^;]+;/g)).toEqual([
      "grant execute on function public.get_project_finished_goods_reservation_context(uuid) to authenticated;",
    ]);
    expect(sql.match(/security definer/g)).toHaveLength(1);
    expect(sql).toContain("language plpgsql stable security definer set search_path = ''");
    expect(sql).toContain("revoke all on function public.calculate_project_product_demand(uuid,uuid)");
    expect(sql).toContain("from public, anon, authenticated, service_role");
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create table|create trigger|disable trigger)\b/i);
  });
  it("requires active Project plus FG view, never other warehouse/adjust/mutation permissions", () => {
    expect(sql).toContain("public.current_active_user_profile_id() is null");
    expect(sql).toContain("public.current_user_is_admin() or (public.has_permission('projects.view')");
    expect(sql).toContain("public.has_permission('inventory.finished_goods.view')");
    expect(sql).not.toMatch(/inventory\.(raw_materials|customs)|finished_goods\.(adjust|reserve)/);
  });
  it("shares exact demand arithmetic while preserving the open-commitment lifecycle filter", () => {
    expect(sql.match(/pg_catalog.sum\(-movement.quantity_delta::numeric\)/g)).toHaveLength(1);
    expect(sql).toContain("'work_order','pcb_production_input','finished_goods_reservation_fulfillment'");
    expect(sql).toContain("public.calculate_project_product_demand(null,p_product_id)");
    expect(sql).toContain("where project.status in ('planned','in_progress','on_hold')");
    const read = sql.slice(sql.indexOf("create function public.get_project_finished_goods_reservation_context"));
    expect(read).not.toMatch(/product\.is_active|project\.status|join public\.project_product_components/);
    expect(read.match(/return query/g)).toHaveLength(1);
  });
  it("returns exact types with only own identity and an aggregate for foreign reservations", () => {
    for (const field of ["planned_requirement numeric", "actual_project_consumption numeric", "outstanding_demand numeric",
      "physical_quantity bigint", "globally_reserved_quantity bigint", "available_quantity bigint",
      "project_reserved_quantity bigint", "reservation_id uuid", "reservation_version bigint"])
      expect(sql).toContain(field);
    expect(sql).toContain("on own.project_id = p_project_id and own.product_id = demanded.product_id");
    expect(sql).toContain("coalesce(own.version,0::bigint)");
    expect(sql).not.toMatch(/float|double precision|json_agg|jsonb_agg/);
  });
  it("keeps zero-stock outputs and calculates FG-only availability in one statement without clamping", () => {
    expect(sql).toContain("card.output_product_id = product.id");
    expect(sql).toContain("left join public.inventory_balances balance");
    expect(sql).toContain("balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid");
    expect(sql).toContain("coalesce(balance.quantity,0::bigint)::numeric - coalesce(reserved.quantity,0::numeric)");
    expect(sql).toContain("pg_catalog.sum(state.reserved_quantity::numeric)");
    expect(sql).not.toContain("balance.quantity > 0");
  });
  it("documents the implemented read without claiming frontend, activation or DEV deployment", () => {
    for (const file of ["BUILD_PLAN", "DATA_MODEL", "PERMISSIONS", "SECURITY_RULES"]) {
      const doc = readFileSync(`docs/${file}.md`, "utf8");
      expect(doc).toContain("get_project_finished_goods_reservation_context");
      expect(doc).toContain("frontend pending, mutation activation pending,");
      expect(doc).toContain("DEV deployment pending");
    }
  });
});
