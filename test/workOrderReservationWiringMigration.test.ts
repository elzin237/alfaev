import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";
const file="20261030170000_wire_draft_work_order_reservation_lifecycle.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("is forward migration 177 with all six reviewed foundation migrations unchanged",()=>{
  const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();expect(files[176]).toBe(file);
  const hashes=["6d6a089f61a0a40825439c2d75bcf4a76c2b14575c520e860d7b67104e648587","63d1e9f3a78e3f93780090c23cfe6dc2d1f489d8b7f8385dc2c5488a0f38788d","e7872278bce4d920a1540847ddfcb5a5fbfc67fe6cdb6554334dacc61d3f5051","4897806fe5fde8c953c4b7a6a070a01a3bfbe3d7e793ab30801f147bbf0adf2d","5368e49d6669d304037ff9a8a1acc0cfcd779161b78e90f11384bf3654a314dd","0552c26bba8cef0559128dfc5b5eb08bb54c807904566dc717f57be68a0b5146"];
  expect(files.slice(170,176).map(f=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex"))).toEqual(hashes);
});
it("defaults the private transactional gate OFF with no application mutation/override",()=>{expect(sql).toContain("values(true,false)");expect(sql).toContain("enable row level security");expect(sql).toContain("where singleton for share");expect(sql).toContain("from public,anon,authenticated,service_role");expect(sql).not.toMatch(/set_config|current_setting|grant.*work_order_reservation_activation/i);});
it("reuses the allocator and preserves parent responses without private EXECUTE or physical writes",()=>{for(const name of ["create_draft_work_order","create_pcb_production_work_order","save_draft_work_order","save_pcb_production_supplemental_materials","delete_draft_work_order"])expect(sql).toContain(`public.${name}_reservation_base`);expect(sql).toContain("Unexpected lifecycle parent");expect(sql).toContain("draft_reservation_request_id");expect(sql).not.toMatch(/insert into public\.inventory|update public\.inventory|grant execute.*stage_draft/);expect(sql).toContain("to authenticated");});
