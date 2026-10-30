import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {describe,it,expect} from "vitest";
const file="20261029140000_add_atomic_test_calculator_import.sql",sql=readFileSync(`supabase/migrations/${file}`,"utf8");
describe("Atomic Test import RPC",()=>{
  it("is migration 169 and preserves reviewed 167/168",()=>{
    expect(readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()[168]).toBe(file);
    for(const [f,hash] of [["20261029120000_add_test_calculator_import_foundation.sql","c8234f0f3fbdf119aebb7f594818b95d241c2a549c1161c0e712f211fd73a954"],
      ["20261029130000_make_test_commitments_release_aware.sql","0518fd19d4ee77c381818ad1b3bc2423d2fa45f75db1e5bc3b653b4149e09b48"]])
      expect(createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex")).toBe(hash);
  });
  it("requires active combined permission and warehouse authority with narrow EXECUTE",()=>{
    for(const permission of ["test_calculator.view","test_calculator.manage","pcb.view","pcb.create","pcb.edit",
      "inventory.finished_goods.view","inventory.raw_materials.view","inventory.customs.view"])expect(sql).toContain(`'${permission}'`);
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("grant execute on function public.import_test_calculation(uuid,uuid,text) to authenticated");
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete)|create policy/i);
  });
  it("serializes request/source and checks actor ownership before private payload comparison",()=>{
    expect(sql).toContain("'test-import-request:'");expect(sql).toContain("'test-import-source:'");
    expect(sql.indexOf("original.imported_by_user_id<>actor")).toBeLessThan(sql.indexOf("original.submitted_payload is distinct"));
    expect(sql).toContain("original.auth_user_id<>auth.uid()");expect(sql).toContain("return original.import_receipt");
    expect(sql).toContain("errcode='TCI01'");expect(sql).toContain("errcode='TCI02'");
  });
  it("locks Products then balances and observes expiry after destination/BOM waits",()=>{
    expect(sql.indexOf("order by product.id for update")).toBeLessThan(sql.indexOf("order by balance.product_id,balance.warehouse_id for update"));
    expect(sql.indexOf("public.save_initial_pcb_bom(")).toBeLessThan(sql.indexOf("imported_at := pg_catalog.clock_timestamp()"));
    expect(sql).toContain("public.active_test_holds_at(imported_at,ids)");expect(sql).toContain("where hold.calculation_id=source.id");
    expect(sql).toContain("'read committed'");
  });
  it("copies saved required quantities without expansion or physical stock writes",()=>{
    expect(sql).toContain("'quantity_per_card',item.required_quantity::text");
    expect(sql).toContain("public.create_pcb_card(source.name,p_serial_number)");expect(sql).toContain("initial_bom.version_number<>1");
    expect(sql).toContain("p_serial_number !~ '^[0-9]{3}$'");
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:inventory_|finished_goods_project|work_orders|test_calculations\b|test_calculation_items\b|test_calculation_holds\b)/i);
  });
  it("drains private consistency and coalesced shortage checks before return without bypass",()=>{
    for(const name of ["test_calculation_imports_consistent","test_calculation_import_releases_consistent","work_order_material_shortage_queue_process"])expect(sql).toContain(`public.${name}`);
    expect(sql).toContain("public.work_order_material_shortage_queue_process immediate");
    expect(sql).not.toMatch(/disable trigger|session_replication_role|pg_cron/i);
  });
});
