import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "../app/auth/permissions";

const file = "20261027100000_add_test_calculator_foundation.sql";
const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
describe("Test Calculator private database foundation", () => {
  it("is forward migration 151 without changing frozen accounting SQL", () => {
    const files = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort();
    expect(files.indexOf(file)).toBe(150);
    expect(createHash("sha256").update(readFileSync("supabase/migrations/20261026120000_correct_finished_goods_shortage_reconciliation.sql")).digest("hex"))
      .toBe("cc5311466cd2a7026b0a922113ad0c617f912f763fe0f857a73a7ddbb5d79f34");
  });
  it("defines only the three private concepts and no application RPC or stock effects", () => {
    expect(sql.match(/create table public\.[a-z_]+/g)).toEqual([
      "create table public.test_calculations", "create table public.test_calculation_items", "create table public.test_calculation_holds",
    ]);
    expect(sql).not.toMatch(/security definer|grant\s|create policy|create or replace|pg_cron|pg_schedule/i);
    expect(sql).not.toMatch(/(?:insert into|update|delete from|alter table) public\.(?:inventory_|finished_goods_|projects\b|project_product|work_order|pcb_)/i);
    expect(sql).not.toContain("public.user_permissions");
  });
  it("registers exactly the two singular dedicated definitions without prematurely changing the DEV-facing parser contract", () => {
    expect(sql.match(/\('test_calculator\.[a-z]+'/g)).toEqual(["('test_calculator.view'", "('test_calculator.manage'"]);
    expect(PERMISSION_KEYS).toHaveLength(39);
    expect(sql).not.toContain("test_calculators.");
  });
  it("retains immutable actor-bound receipts, mandatory Sarajevo dates and expiry instants", () => {
    for (const text of ["created_by_user_id uuid not null references public.user_profiles(id) on delete restrict",
      "request_id uuid not null unique", "submitted_payload jsonb not null", "save_receipt jsonb not null",
      "deadline_date date not null", "expires_at timestamptz not null", "expires_at > created_at",
      "((deadline_date + 1)::timestamp at time zone 'Europe/Sarajevo')"])
      expect(sql).toContain(text);
    expect(sql.match(/before update or delete/g)).toHaveLength(3);
    expect(sql.match(/before truncate/g)).toHaveLength(3);
    expect(sql).toContain("using errcode = '55000'");
  });
  it("uses exact quantities, restricted relationships and deferred warehouse total checks", () => {
    expect(sql).toContain("required_quantity bigint not null check (required_quantity > 0)");
    expect(sql).toContain("quantity bigint not null check (quantity >= 0)");
    expect(sql).toContain("required_quantity::numeric = held_quantity::numeric + uncovered_quantity::numeric");
    expect(sql).toContain("foreign key (item_id, calculation_id, product_id)");
    expect(sql).toContain("references public.test_calculation_items(id, calculation_id, product_id) on delete restrict");
    expect(sql.match(/deferrable initially deferred/g)).toHaveLength(2);
    expect(sql).not.toMatch(/double precision|\bfloat\b|on delete cascade/i);
  });
  it("enables RLS, denies direct access to every application role and keeps trigger helpers private", () => {
    expect(sql.match(/enable row level security/g)).toHaveLength(3);
    expect(sql.match(/from public, anon, authenticated, service_role/g)).toHaveLength(3);
    expect(sql.match(/security invoker set search_path = ''/g)).toHaveLength(2);
    expect(sql).not.toMatch(/where[^;]+(?:now\(|clock_timestamp\()/i);
  });
});
