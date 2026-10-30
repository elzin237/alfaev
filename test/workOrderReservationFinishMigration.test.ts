import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {it,expect} from "vitest";
const file="20261030140000_integrate_work_order_reservations_into_finish.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("174 preserves historical protection migration and does not activate Draft writers",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[173]).toBe(file);
  expect(createHash("sha256").update(readFileSync("supabase/migrations/20261030130000_protect_draft_work_order_commitments.sql")).digest("hex")).toBe("e7872278bce4d920a1540847ddfcb5a5fbfc67fe6cdb6554334dacc61d3f5051");
  expect(sql).not.toMatch(/stage_draft_work_order_reservations|disable trigger|set_config|work_order_project_requirement_coverage/);
});
it("174 retains guarded debit, ownership-bound fingerprints, actor receipts and authenticated-only Finish",()=>{
  for(const value of ["consume_work_order_owned_allocation","bind_work_order_reservation_fingerprint","phase','begin'","phase','result'","'consumed'","'released'","reservation_foundation_consistent","using errcode='WOR11'"])expect(sql).toContain(value);
  expect(sql).toContain("from public,anon,authenticated,service_role");expect(sql).toContain("to authenticated");
});
