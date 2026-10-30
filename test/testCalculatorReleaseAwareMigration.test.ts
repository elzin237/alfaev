import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {describe,it,expect} from "vitest";
const file="20261029130000_make_test_commitments_release_aware.sql", sql=readFileSync(`supabase/migrations/${file}`,"utf8");
describe("Release-aware Test commitments",()=>{
  it("is forward migration 168 and preserves foundation 167 byte-for-byte",()=>{
    expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[167]).toBe(file);
    expect(createHash("sha256").update(readFileSync("supabase/migrations/20261029120000_add_test_calculator_import_foundation.sql")).digest("hex"))
      .toBe("c8234f0f3fbdf119aebb7f594818b95d241c2a549c1161c0e712f211fd73a954");
  });
  it("uses one exact nonnegative warehouse/hold identity and expiry definition",()=>{
    for(const t of ["p_expires_at > p_as_of","p_original::numeric - coalesce(p_released,0)::numeric",
      "released.item_id=hold.item_id","released.warehouse_id=hold.warehouse_id","released.calculation_id=hold.calculation_id",
      "released.product_id=hold.product_id","imported.imported_at <= p_as_of","where effective.quantity > 0"])expect(sql).toContain(t);
    expect(sql).not.toMatch(/\bfloat\b|double precision|on delete cascade/i);
  });
  it("patches every direct operational aggregator while retaining time boundaries",()=>{
    for(const t of ["public.preview_test_calculation(jsonb)","public.save_test_calculation(uuid,text,jsonb,date)",
      "public.get_inventory_test_commitments(uuid,text)","public.active_test_holds_at(read_at,ids)","public.active_test_holds_at(saved_at,ids)",
      "pg_catalog.min(hold.expires_at)","public.get_production_free_warehouse_quantity_at(","public.active_test_warehouse_hold_quantity("])
      expect(sql).toContain(t);
    expect(sql).toContain("Unexpected Test hold consumer definition");
    expect(sql).toContain("pg_catalog.clock_timestamp() at_time");
  });
  it("adds only private invoker helpers and no stock writes, import or release endpoint",()=>{
    expect(sql).not.toMatch(/security definer|grant\s|create policy|create table|insert into|update public|delete from public/i);
    expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(4);
    expect(sql).not.toContain("create function public.import_test");
  });
  it("queues release Products through existing bounded/coalesced WO reconciliation",()=>{
    expect(sql).toContain("after insert on public.test_calculation_import_releases");
    expect(sql).toContain("public.queue_work_order_material_shortage_reconciliation()");
    expect(sql).not.toMatch(/pg_cron|pg_schedule|notify\s/i);
  });
});
