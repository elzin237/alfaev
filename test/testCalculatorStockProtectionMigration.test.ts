import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql=readFileSync("supabase/migrations/20261027130000_protect_test_calculator_warehouse_holds.sql","utf8");
describe("Test warehouse stock protection",()=>{
  it("preserves migrations 1–153 byte-for-byte",()=>{
    const hash=createHash("sha256");
    for(const file of readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort().slice(0,153))
      hash.update(file+"\0").update(readFileSync(`supabase/migrations/${file}`));
    expect(hash.digest("hex")).toBe("903fca1f8d5e957b7e37a3c3fae06cd48ab52e12c2d66610abf7aad016e0ec04");
  });
  it("guards every balance decrease with combined warehouse holds",()=>{
    expect(sql).toContain("before update of quantity on public.inventory_balances");
    expect(sql).toContain("when (new.quantity < old.quantity)");
    expect(sql).toContain("new.quantity::numeric < tests + projects");
    expect(sql).toContain("hold.warehouse_id = p_warehouse_id");
    expect(sql).toContain("calculation.expires_at > observed.at_time");
    expect(sql).toContain("pg_catalog.clock_timestamp()");
    expect(sql).toContain("current_setting('transaction_isolation') <> 'read committed'");
  });
  it("preserves private boundaries and contains no data rewrite or bypass",()=>{
    expect(sql).toContain("volatile security definer set search_path = ''");
    expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(2);
    expect(sql).not.toMatch(/grant execute|disable trigger|disable row level|for update|for share|\b(?:insert into|delete from|update public)\b/i);
    expect(sql).not.toContain("create or replace");
  });
});
