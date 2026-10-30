import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {it,expect} from "vitest";
const file="20261030150000_add_inventory_draft_commitment_reads.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("175 is additive, preserves migration 174 and does not activate reservation creation",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[174]).toBe(file);
  expect(createHash("sha256").update(readFileSync("supabase/migrations/20261030140000_integrate_work_order_reservations_into_finish.sql")).digest("hex")).toBe("4897806fe5fde8c953c4b7a6a070a01a3bfbe3d7e793ab30801f147bbf0adf2d");
  expect(sql).not.toMatch(/create or replace|stage_draft_work_order_reservations|update public\.inventory|insert into public\.inventory|update public\.work_order_material_reservation/);
});
it("175 separates protected stock/planning, zero coverage and coalesced Product reconciliation",()=>{
  for(const text of ["project_coverage_quantity','0'","warehouse_work_order_held_quantity","raw_customs_planning","get_work_order_material_availability","active_draft_warehouse_hold_quantity","on conflict do nothing","limit p_limit+1","from public,anon,authenticated,service_role"])expect(sql).toContain(text);
});
