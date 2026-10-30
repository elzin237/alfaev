import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const file="20261030120000_add_private_work_order_reservation_lifecycle.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("is private forward migration 172 with foundation 171 unchanged",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[171]).toBe(file);
  expect(createHash("sha256").update(readFileSync("supabase/migrations/20261030110000_add_work_order_reservation_foundation.sql")).digest("hex")).toBe("6d6a089f61a0a40825439c2d75bcf4a76c2b14575c520e860d7b67104e648587");
  expect(sql).not.toMatch(/create or replace|create trigger|grant execute|alter function|update public\.inventory|insert into public\.inventory|work_order_project_requirement_coverage/i);
  expect(sql).toContain("from public,anon,authenticated,service_role");expect(sql).toContain("security definer set search_path=''");
});
it("retains parent authority, retries, net-increase admission and canonical saved requirements",()=>{
  for(const key of ["work_orders.create","work_orders.edit_draft","work_orders.delete_draft","pcb.produce"])expect(sql).toContain(key);
  expect(sql).toContain("original.actor_user_id<>actor");expect(sql).toContain("return original.receipt");expect(sql).toContain("WOR05");
  expect(sql).toContain("greatest(required_now::numeric-required_before::numeric,0)");expect(sql).toContain("sum(i.quantity::numeric)");
  expect(sql).toContain("public.delete_draft_work_order");expect(sql).toContain("public.save_pcb_production_supplemental_materials");
});
