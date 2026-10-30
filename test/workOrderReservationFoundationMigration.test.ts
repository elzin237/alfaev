import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const file="20261030110000_add_work_order_reservation_foundation.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
it("is inert forward migration 171 and preserves reviewed Test import migrations",()=>{
  expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[170]).toBe(file);
  const reviewed=[["20261029120000_add_test_calculator_import_foundation.sql","c8234f0f3fbdf119aebb7f594818b95d241c2a549c1161c0e712f211fd73a954"],["20261029130000_make_test_commitments_release_aware.sql","0518fd19d4ee77c381818ad1b3bc2423d2fa45f75db1e5bc3b653b4149e09b48"],["20261029140000_add_atomic_test_calculator_import.sql","7bdc2cddcb9917d0e6023341d395a8cd572b5824d25227cefdb9fb3de03b016a"],["20261030100000_add_test_calculation_conversion_reads.sql","3db0764eb904e10fd0465b0f859d008c33d7d52a6204d5af676facb5ecf67fe5"]];
  for(const [name,hash] of reviewed)expect(createHash("sha256").update(readFileSync(`supabase/migrations/${name}`)).digest("hex")).toBe(hash);
  expect(sql).not.toMatch(/create or replace function|alter table public\.(work_orders|work_order_items|inventory_balances)|grant execute/i);
  expect(sql).toContain("effective_quantity bigint generated always as (0::bigint)");
});
it("keeps private RLS, deletion-compatible history, exact numeric checks and no public RPC",()=>{
  expect(sql).toContain("enable row level security");expect(sql).toContain("from public,anon,authenticated,service_role");
  expect(sql).toContain("on delete set null");expect(sql).toContain("deferrable initially deferred");
  expect(sql).toContain("quantity_before::numeric-quantity::numeric");expect(sql).toContain("get_production_free_warehouse_quantity");
  expect(sql).not.toMatch(/insert into public\.(inventory|test_calculation|finished_goods_project)|backfill/i);
});
