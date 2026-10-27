import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/20261023140000_activate_finished_goods_project_reservation_mutations.sql", "utf8");
describe("reservation activation preparation (static only; never applies migration)", () => {
  it("grants only the exact three public wrappers to authenticated", () => {
    expect(sql.match(/^grant[^;]+;/gm)).toEqual([
      "grant execute on function public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid) to authenticated;",
      "grant execute on function public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid) to authenticated;",
      "grant execute on function public.fulfill_finished_goods_project_reservation(uuid,uuid,uuid,bigint,bigint,uuid) to authenticated;",
    ]);
    expect(sql).not.toMatch(/\b(create|alter|drop|revoke|insert|update|delete|truncate)\s+(table|function|trigger|policy|into|public\.)/i);
  });
  it("validates positive authenticated privilege and negative PUBLIC/anon/service/helper/table privileges", () => {
    expect(sql).toContain("not pg_catalog.has_function_privilege('authenticated',function_id,'EXECUTE')");
    expect(sql).toContain("routine.prosecdef and routine.provolatile = 'v'");
    expect(sql).toContain("routine.proconfig = array['search_path=\"\"']::text[]");
    expect(sql).toContain("acl.grantee = 0");
    for (const role of ["anon", "service_role"]) expect(sql).toContain(`pg_catalog.has_function_privilege('${role}',function_id,'EXECUTE')`);
    for (const helper of ["change_finished_goods_project_reservation", "apply_inventory_delta_in_warehouse", "validate_finished_goods_fulfillment_link", "calculate_project_product_demand"])
      expect(sql).toContain(`'public.${helper}'`);
    expect(sql).toContain("relation.relrowsecurity");
    expect(sql).toContain("pg_catalog.has_table_privilege(role_name,signature,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')");
    expect(sql).not.toContain("execute format");
  });
  it("preserves all frozen reservation SQL identities", () => {
    for (const [name, hash] of [
      ["20261023100000_add_finished_goods_project_reservation_foundation.sql", "2ebc25516dd399a1bf340ee38cb9c242ef0d82666d4c6f858516afb5c10cbcd8"],
      ["20261023110000_protect_finished_goods_hard_reservations.sql", "f5e6f68a2df0692f0e2827baefe29d33d7da6b267a125e5b723eab46317e324b"],
      ["20261023120000_add_finished_goods_reservation_fulfillment.sql", "3504ef24ca9f3863934d782c43780f32153b610c037de02330e26291d4b87173"],
      ["20261023130000_add_project_finished_goods_reservation_context.sql", "e74f6bb184e06c999c72a6f2e141fb77fcc82a6d5da0d69194189cc09ba6bdba"],
    ]) expect(createHash("sha256").update(readFileSync(`supabase/migrations/${name}`)).digest("hex")).toBe(hash);
  });
});
