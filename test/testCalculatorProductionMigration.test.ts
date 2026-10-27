import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql=readFileSync("supabase/migrations/20261027140000_protect_test_holds_in_production_plans.sql","utf8");
describe("Test-aware production plans",()=>{
  it("preserves frozen migrations 1–154",()=>{
    const hash=createHash("sha256");
    for(const f of readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort().slice(0,154))hash.update(f+"\0").update(readFileSync(`supabase/migrations/${f}`));
    expect(hash.digest("hex")).toBe("b4bd7fff3b6542f7795b160384281b90216f77fd938e15a3dce300cbaf362b28");
  });
  it("reuses protected free capacity and preserves private contracts",()=>{
    expect(sql).toContain("public.active_test_warehouse_hold_quantity(balance.product_id,balance.warehouse_id)");
    expect(sql).toContain("public.is_calculator_finished_product(p_product_id)");
    expect(sql).toContain("state.reserved_quantity::numeric");
    expect(sql).toContain("returns bigint language sql volatile security invoker set search_path = ''");
    expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(3);
    expect(sql).not.toMatch(/grant execute|security definer|calculate_open_project_commitments|\b(?:insert into|delete from|update public)\b/i);
  });
  it("reads Test expiry only after all allocation locks and keeps FIFO/fingerprint fields",()=>{
    expect(sql.indexOf("into capacities")).toBeGreaterThan(sql.indexOf("lot.received_at,lot.id for update"));
    expect(sql).toContain("partition by lot.warehouse_id order by lot.received_at,lot.id");
    expect(sql).toContain("source_lot_id uuid, source_kind text");
    expect(sql).toContain("catalog_number_snapshot text");
    expect(sql).toContain("current_setting('transaction_isolation') <> 'read committed'");
  });
});
