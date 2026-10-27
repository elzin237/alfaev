import { createHash } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import { describe,expect,it } from "vitest";
const sql=readFileSync("supabase/migrations/20261027160000_add_expiry_aware_inventory_test_commitments.sql","utf8");
describe("expiry-aware Inventory Test reads",()=>{
  it("preserves migrations 1–156",()=>{
    const hash=createHash("sha256");
    for(const f of readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort().slice(0,156))hash.update(f+"\0").update(readFileSync(`supabase/migrations/${f}`));
    expect(hash.digest("hex")).toBe("7f5f91f8fe58be79bb142b8ac412a7205d46bf09b54a5284b868579180f45be0");
  });
  it("uses one authoritative time, exact text, existing membership and narrow authorization",()=>{
    expect(sql.match(/pg_catalog.clock_timestamp\(\)/g)).toHaveLength(1);
    expect(sql).toContain("calculation.expires_at > read_at");
    expect(sql).toContain("public.search_inventory_products_by_warehouse(p_warehouse_id,p_search)");
    expect(sql).toContain("public.has_permission('inventory.customs.view')");
    expect(sql).toContain("stable security definer set search_path = ''");
    expect(sql).toContain("committed_to_tests text,available_after_projects_and_tests text");
    expect(sql).toContain("grant execute on function public.get_inventory_test_commitments(uuid,text) to authenticated");
    expect(sql).not.toMatch(/test_calculator.view|save_receipt|submitted_payload|created_by_user_id|\b(?:insert into|update public|delete from|for update)\b/i);
  });
});
