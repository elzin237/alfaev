import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const dir="supabase/migrations/",name="20261029100000_add_bounded_work_order_shortage_initialization.sql";
const sql=readFileSync(dir+name,"utf8");
it("adds migration 165 without rewriting deployed 162–164",()=>{
  expect(readdirSync(dir).filter(f=>/^\d{14}_/.test(f)).sort()[164]).toBe(name);
  for(const [file,hash] of [
    ["20261028130000_add_work_order_material_availability.sql","9216de726f1f4d19f2b9f92788fc2c57057e864dd57b09726bbbf0d0bd226ebf"],
    ["20261028140000_add_work_order_material_shortage_episodes.sql","ce662cbf519abdbfbb9c2b462756d174349a24cbb8bd1601f036298b65ce19a6"],
    ["20261028150000_deliver_work_order_shortage_notifications.sql","e2e6cb7b802be8eb1b7981f92863e9d2d72aa28bc18955966dfdd2c769033a5e"],
  ]) expect(createHash("sha256").update(readFileSync(dir+file)).digest("hex")).toBe(hash);
});
it("is operator-only, without a new elevated execution or browser grant",()=>{
  expect(sql).toContain("security invoker set search_path=''");
  expect(sql).toContain("from public,anon,authenticated,service_role");
  expect(sql).not.toMatch(/grant\s+|security definer/i);
});
it("bounds the entire shared-Product reconciliation scope before execution",()=>{
  expect(sql).toContain("cardinality(p_product_ids) not between 1 and 20");
  expect(sql).toContain("p_max_pairs not between 1 and 100");
  expect(sql).toContain("lock table public.work_orders, public.work_order_items in share mode");
  expect(sql.indexOf("if pair_count > p_max_pairs")).toBeLessThan(sql.indexOf("perform public.reconcile_"));
  expect(sql).toContain("order by id loop");
});
it("only invokes existing authoritative reconciliation, with no automatic initialization or accounting SQL",()=>{
  expect(sql.match(/perform public.reconcile_work_order_material_shortages_for_product/g)).toHaveLength(1);
  expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create trigger|do \$)/i);
});
