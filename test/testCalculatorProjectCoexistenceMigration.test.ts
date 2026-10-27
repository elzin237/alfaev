import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql=readFileSync("supabase/migrations/20261027150000_protect_test_holds_in_project_reservation_admission.sql","utf8");
describe("Project/Test reservation admission",()=>{
  it("preserves frozen migrations 1–155",()=>{
    const hash=createHash("sha256");
    for(const f of readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort().slice(0,155))hash.update(f+"\0").update(readFileSync(`supabase/migrations/${f}`));
    expect(hash.digest("hex")).toBe("c4914dbc7b4c9848806cbcdb41c04934446c8f1f96195d2c35f5c149d69b7f62");
  });
  it("changes only both post-lock admission checks and fails on source drift",()=>{
    expect(sql).toContain("change_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid,boolean)");
    expect(sql).toContain("mutate_project_requirement(uuid,text,uuid,uuid,uuid,uuid,bigint,uuid,bigint)");
    expect(sql.match(/public.active_test_warehouse_hold_quantity\(/g)).toHaveLength(2);
    expect(sql.match(/current_setting\('transaction_isolation'\)/g)).toHaveLength(2);
    expect(sql).toContain("<> pg_catalog.length(change.needle)");
    expect(sql).toContain("physical_quantity::numeric - total_reserved");
    expect(sql).toContain("physical::numeric-global_reserved");
    expect(sql).not.toMatch(/\bgrant\b|disable trigger|alter table|\b(?:insert into|delete from|update public)\b/i);
  });
});
