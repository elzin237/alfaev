import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/20261027120000_add_atomic_test_calculator_save.sql", "utf8");
describe("atomic Test Calculator Save contract", () => {
  it("preserves the foundation and preview migrations", () => {
    for (const [file, hash] of [
      ["20261027100000_add_test_calculator_foundation.sql", "e8d7b802a4b828cc685ddaaafc33371fa6d8c79ca76cf454fdcc80c6fb603684"],
      ["20261027110000_add_test_calculator_search_and_preview.sql", "1a11b4e6a66c860be33f4fbc526fc38c488b0adc46d94359d0bf98ea00e990d7"],
    ]) expect(createHash("sha256").update(readFileSync(`supabase/migrations/${file}`)).digest("hex")).toBe(hash);
  });
  it("uses a narrow trusted boundary and no physical mutation", () => {
    expect(sql).toContain("volatile security definer set search_path = ''");
    expect(sql).toContain("grant execute on function public.save_test_calculation(uuid,text,jsonb,date) to authenticated");
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:inventory_balances|inventory_movements|inventory_source_lots|work_orders)/i);
    expect(sql).not.toMatch(/disable trigger|disable row level security/i);
  });
  it("checks actor ownership before payload comparison and deadline after locks", () => {
    expect(sql.indexOf("original.created_by_user_id <> actor")).toBeLessThan(sql.indexOf("original.submitted_payload is distinct from payload"));
    expect(sql.indexOf("saved_at := pg_catalog.clock_timestamp()")).toBeGreaterThan(sql.indexOf("order by balance.product_id,balance.warehouse_id for update"));
    expect(sql).toContain("return original.save_receipt");
    expect(sql).toContain("set constraints public.test_calculation_items_hold_total, public.test_calculation_holds_item_total immediate");
    expect(sql).toContain("calculation.expires_at > saved_at");
    expect(sql).toContain("current_setting('transaction_isolation') <> 'read committed'");
    expect(sql).toContain("'quantity',((item.value->>'quantity')::bigint)::text");
  });
});
