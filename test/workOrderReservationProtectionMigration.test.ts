import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {it,expect} from "vitest";
const file="20261030130000_protect_draft_work_order_commitments.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("173 is forward-only and leaves historical reservation migrations unchanged",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[172]).toBe(file);
  for(const [name,hash] of [["20261030110000_add_work_order_reservation_foundation.sql","6d6a089f61a0a40825439c2d75bcf4a76c2b14575c520e860d7b67104e648587"],["20261030120000_add_private_work_order_reservation_lifecycle.sql","63d1e9f3a78e3f93780090c23cfe6dc2d1f489d8b7f8385dc2c5488a0f38788d"]])expect(createHash("sha256").update(readFileSync(`supabase/migrations/${name}`)).digest("hex")).toBe(hash);
  expect(sql).not.toMatch(/grant execute|create trigger|insert into public\.|update public\.|delete from public\./i);
});
it("173 preserves private, owner-aware, single-deduction boundaries and fails closed on definition drift",()=>{
  expect(sql).toContain("s.status='active' and w.status='draft'");expect(sql).toContain("get_locked_work_order_production_capacity");
  expect(sql).toContain("get_production_capacity_without_draft_holds");expect(sql).toContain("Unexpected Draft protection consumer");expect(sql).toContain("from public,anon,authenticated,service_role");
  for(const name of ["protect_test_calculator_warehouse_holds","preview_test_calculation","save_test_calculation","change_finished_goods_project_reservation","mutate_project_requirement","get_work_order_material_availability","reconcile_work_order_material_shortages_for_product"])expect(sql).toContain(name);
});
