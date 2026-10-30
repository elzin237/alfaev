import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = "20261029120000_add_test_calculator_import_foundation.sql";
const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
describe("Import from Test private foundation", () => {
  it("is forward migration 167 and preserves deployed 166", () => {
    expect(readdirSync("supabase/migrations").filter(f => /^\d{14}_.+\.sql$/.test(f)).sort()[166]).toBe(file);
    expect(createHash("sha256").update(readFileSync("supabase/migrations/20261029110000_track_active_work_order_shortages.sql")).digest("hex"))
      .toBe("0b3aad6547c284310a1cf3788f714b8529f0a20132aafb4e7b8f6fbaf58f4550");
  });
  it("adds exactly two inert private tables and no public import or release operation", () => {
    expect(sql.match(/create table public\.\w+/g)).toEqual(["create table public.test_calculation_imports", "create table public.test_calculation_import_releases"]);
    expect(sql).not.toMatch(/security definer|create policy|grant\s|create or replace|insert into|update public|delete from public/i);
    expect(sql).not.toMatch(/alter table public\.(?:test_calculations|test_calculation_items|test_calculation_holds)\b/);
  });
  it("retains actor-bound private request receipts and single destination identity", () => {
    for (const fragment of ["calculation_id uuid not null unique", "pcb_card_id uuid not null unique", "output_product_id uuid not null unique",
      "initial_bom_version_id uuid not null unique", "request_id uuid not null unique", "auth_user_id uuid not null references auth.users(id)",
      "submitted_payload jsonb not null", "import_receipt jsonb not null", "'confirmed', true"])
      expect(sql).toContain(fragment);
  });
  it("enforces exact source hold ownership, bigint quantities and deferred set consistency", () => {
    for (const fragment of ["quantity bigint not null check (quantity > 0)", "primary key (item_id, warehouse_id)",
      "foreign key (import_id, calculation_id)", "foreign key (item_id, calculation_id, product_id)",
      "references public.test_calculation_holds(item_id, warehouse_id)", "source.expires_at > conversion.imported_at",
      "item.required_quantity::text", "item.quantity_per_card::text", "expected is distinct from actual"])
      expect(sql).toContain(fragment);
    expect(sql.match(/deferrable initially deferred/g)).toHaveLength(2);
    expect(sql).not.toMatch(/on delete cascade|double precision|\bfloat\b/i);
  });
  it("denies application access, mutation and truncation without privileged helpers", () => {
    expect(sql.match(/enable row level security/g)).toHaveLength(2);
    expect(sql.match(/before update or delete/g)).toHaveLength(2);
    expect(sql.match(/before truncate/g)).toHaveLength(2);
    expect(sql.match(/security invoker set search_path = ''/g)).toHaveLength(2);
    expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(2);
  });
});
