import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261013113000_correct_supplier_catalog_authority.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("Supplier catalog authority correction migration", () => {
  it("adds normalized Supplier-owned Catalog Number and optional Description", () => {
    expect(migration).toContain("alter table public.suppliers\n  add column catalog_number text,\n  add column description text");
    expect(migration).toContain("suppliers_catalog_number_normalized");
    expect(migration).toContain("suppliers_description_normalized");
    expect(migration).toContain("suppliers_active_catalog_required");
    expect(migration).toContain("check (not is_active or catalog_number is not null)");
  });

  it("uses only the approved explicit values or one unambiguous active value", () => {
    expect(migration).toContain("set catalog_number = 'ansoyo26'");
    expect(migration).toContain("set catalog_number = 'ibp26'");
    expect(migration).toContain("select distinct relationship.supplier_id, relationship.catalog_number");
    expect(migration).toContain("relationship.is_active");
    expect(migration).toContain("other.catalog_number <> candidate.catalog_number");
    expect(migration).not.toMatch(/\b(?:min|max)\s*\(\s*relationship\.catalog_number/i);
    expect(migration).not.toMatch(/order by[^;]+catalog_number[^;]+limit 1/i);
  });

  it("removes stale browser-owned ProductSupplier metadata contracts", () => {
    expect(migration).toContain("drop function public.create_product_supplier(uuid, uuid, text, text)");
    expect(migration).toContain("drop function public.update_product_supplier(uuid, text, text)");
    expect(migration).toContain("create function public.create_product_supplier(\n  p_product_id uuid,\n  p_supplier_id uuid\n)");
    expect(migration).toContain("create unique index product_suppliers_one_active_pair_idx");
    expect(migration).not.toContain("create function public.update_product_supplier(");
  });

  it("reads live Supplier fields for current views and freezes them for inbound lots", () => {
    expect(migration).toContain("supplier.catalog_number, supplier.description, relationship.is_active");
    expect(migration).toContain("source_supplier.catalog_number, source_supplier.description");
    expect(migration).not.toContain("source_relationship.catalog_number, source_relationship.description");
  });

  it("removes Catalog input from Procurement Product creation", () => {
    expect(migration).toContain("drop function public.create_product_from_procurement_request(uuid, text, text, uuid, text)");
    expect(migration).toContain("create function public.create_product_from_procurement_request(\n  p_request_id uuid,\n  p_name text,\n  p_category text,\n  p_brand_id uuid default null\n)");
    expect(migration).toContain("public.create_product_supplier(\n      created_product_id, current_request.supplier_id\n    )");
  });

  it("keeps trusted functions hardened", () => {
    expect(migration.match(/security definer set search_path = ''/g)?.length)
      .toBeGreaterThanOrEqual(8);
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to authenticated");
  });

  it("has a reportable SHA-256", () => {
    expect(createHash("sha256").update(migration).digest("hex"))
      .toMatch(/^[a-f0-9]{64}$/);
  });
});
