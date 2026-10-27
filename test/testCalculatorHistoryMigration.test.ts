import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261027170000_add_test_calculation_history_reads.sql", "utf8");
describe("saved Test Calculation history contract", () => {
  it("preserves every migration 1–157 byte-for-byte", () => {
    const hash = createHash("sha256");
    for (const file of readdirSync("supabase/migrations").filter(f => /^\d{14}_.+\.sql$/.test(f)).sort().slice(0,157))
      hash.update(file+"\0").update(readFileSync(`supabase/migrations/${file}`));
    expect(hash.digest("hex")).toBe("5e13f3e44c989729acf73b38a6e2c09e5c143b3e42a780bd3fd4176580712671");
  });
  it("adds only two stable trusted reads with explicit active shared-view authorization", () => {
    expect(sql.match(/create function public\./g)).toHaveLength(2);
    expect(sql.match(/stable security definer set search_path = ''/g)).toHaveLength(2);
    expect(sql.match(/public.current_active_user_profile_id\(\) is null/g)).toHaveLength(2);
    expect(sql.match(/public.has_permission\('test_calculator.view'\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/created_by_user_id\s*=\s*public.current_active_user_profile_id|inventory\..*\.view|test_calculator.manage/);
  });
  it("returns only explicit saved fields and narrowly scoped creator display", () => {
    expect(sql).toContain("creator.full_name");
    expect(sql).toContain("item.product_name_snapshot");
    expect(sql).toContain("item.serial_number_snapshot");
    expect(sql).not.toMatch(/request_id|submitted_payload|save_receipt|auth_user_id|creator\.(?:email|birthday|is_admin)|to_jsonb|select\s+\*/i);
  });
  it("uses exact decimal strings, one clock per read and exclusive expiry", () => {
    expect(sql.match(/pg_catalog.clock_timestamp\(\)/g)).toHaveLength(2);
    expect(sql.match(/calculation.expires_at > read_at/g)).toHaveLength(2);
    for (const field of ["required_quantity", "held_quantity", "uncovered_quantity"])
      expect(sql).toContain(`item.${field}::text`);
    expect(sql).toContain("hold.quantity::text");
    expect(sql).not.toMatch(/expires_at\s*>\s*read_at\s*(?:and|where)|expires_at\s*>\s*now\(/i);
  });
  it("bounds keyset pagination and authorizes before revealing missing identities", () => {
    expect(sql).toContain("p_limit > 100");
    expect(sql).toContain("(p_before_created_at is null) <> (p_before_id is null)");
    expect(sql).toContain("(calculation.created_at,calculation.id) < (p_before_created_at,p_before_id)");
    expect(sql).toContain("order by calculation.created_at desc,calculation.id desc limit p_limit");
    expect(sql.indexOf("Access denied",sql.indexOf("create function public.get_test_calculation"))).toBeLessThan(sql.indexOf("Calculation not found"));
  });
  it("grants only authenticated function execution and never mutates data or policies", () => {
    expect(sql.match(/grant execute on function .* to authenticated/g)).toHaveLength(2);
    expect(sql.match(/from public,anon,authenticated,service_role/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(?:insert into|update public|delete from|alter table|create policy|for update|save_test_calculation\()\b/i);
  });
});
