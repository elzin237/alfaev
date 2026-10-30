import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const file="20261030180000_add_work_order_requirement_attribution.sql";
const sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("is forward migration 178 and preserves reviewed migrations 171–177",()=>{
  const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();expect(files[177]).toBe(file);
  const hashes=["6d6a089f61a0a40825439c2d75bcf4a76c2b14575c520e860d7b67104e648587","63d1e9f3a78e3f93780090c23cfe6dc2d1f489d8b7f8385dc2c5488a0f38788d","e7872278bce4d920a1540847ddfcb5a5fbfc67fe6cdb6554334dacc61d3f5051","4897806fe5fde8c953c4b7a6a070a01a3bfbe3d7e793ab30801f147bbf0adf2d","5368e49d6669d304037ff9a8a1acc0cfcd779161b78e90f11384bf3654a314dd","0552c26bba8cef0559128dfc5b5eb08bb54c807904566dc717f57be68a0b5146","d3052900f910ed8827789347967aea3cfaa13044575d9853a10c2046ea81339c"];
  expect(files.slice(170,177).map(f=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(hashes);
});
it("keeps the foundation private, inert and separate from physical accounting",()=>{
  expect(sql).toContain("enable row level security");expect(sql).toContain("from public,anon,authenticated,service_role");
  expect(sql).not.toMatch(/grant |create or replace|update public\.|delete from public\.|alter (?:table|function) public\.(?:work_orders|inventory|stage_draft)/i);
  expect(sql).toContain("security definer set search_path=''");expect(sql).toContain("security_invoker=true");
});
it("retains three distinct quantity states without fabricating coverage or independence",()=>{
  expect(sql).toContain("0::numeric verified_coverage_quantity");expect(sql).toContain("admin_independent_quantity");
  expect(sql).toContain("required_quantity-verified_coverage_quantity-admin_independent_quantity unknown_quantity");
  expect(sql).not.toMatch(/w\.project_id|s\.project_id|effective_quantity\s*=/);
});
it("uses immutable actor-bound replacement evidence and current material/lifecycle validation",()=>{
  for(const fragment of ["auth.uid()","current_user_is_admin()","for update","pg_advisory_xact_lock","Attribution history is immutable","WRA01","WRA02","WRA03","unique(state_id,evidence_revision)","unique(supersedes_request_id)","e.material_version=s.version","e.material_updated_at=w.updated_at","independent_quantity<=required_quantity"])
    expect(sql).toContain(fragment);
});
