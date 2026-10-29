import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const dir="supabase/migrations/",file="20261028150000_deliver_work_order_shortage_notifications.sql";
const sql=readFileSync(dir+file,"utf8");
it("adds forward migration 164 and preserves migration 163",()=>{
  expect(readdirSync(dir).filter(f=>/^\d{14}_/.test(f)).sort()[163]).toBe(file);
  expect(createHash("sha256").update(readFileSync(dir+"20261028140000_add_work_order_material_shortage_episodes.sql")).digest("hex"))
    .toBe("ce662cbf519abdbfbb9c2b462756d174349a24cbb8bd1601f036298b65ce19a6");
});
it("keeps delivery and recipient tables private and all trusted paths controlled",()=>{
  expect(sql.match(/enable row level security/g)).toHaveLength(2);
  expect(sql).toContain("from public,anon,authenticated,service_role");
  expect(sql.match(/security definer set search_path=''/g)).toHaveLength(8);
  expect(sql).toContain("unique(outbox_id,recipient_user_id)");
  expect(sql).toContain("outbox_id uuid primary key");
  expect(sql).not.toMatch(/grant\s+(select|insert|update|delete)/i);
});
it("uses independent recipient eligibility and explicit targets without accounting writes or backfill",()=>{
  expect(sql).toContain("d.key='dashboard.view'");expect(sql).toContain("d.key='work_orders.view'");
  expect(sql).toContain("r.recipient_user_id=actor");expect(sql).toContain("'target_type','work_order'");
  expect(sql).toContain("'target_type','project'");expect(sql).toContain("e.missing_quantity::text");
  expect(sql).not.toMatch(/update public\.(inventory|project|work_order_material_shortage_episodes)|delete from|insert into public\.inventory/i);
  expect(sql).not.toMatch(/create or replace|alter function|alter table public\.project/i);
});
