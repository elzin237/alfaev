import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261008100000_allow_procurement_requests_without_supplier.sql",
), "utf8");

describe("Procurement optional Supplier migration", () => {
  it("makes only the Procurement Supplier reference nullable while retaining its FK", () => {
    expect(migration).toContain(
      "alter column supplier_id drop not null",
    );
    expect(migration).not.toContain("drop constraint procurement_requests_supplier_id_fkey");
    expect(migration).not.toContain("disable row level security");
  });

  it("replaces browser creation with supplier-free trusted signatures", () => {
    expect(migration).toContain(
      "create function public.create_procurement_request_for_product(\n  p_product_id uuid,\n  p_requested_quantity bigint",
    );
    expect(migration).toContain(
      "create function public.create_procurement_request_for_new_component(\n  p_requested_name text,\n  p_requested_quantity bigint",
    );
    expect(migration).toContain(
      "drop function public.create_procurement_request_for_product(uuid, uuid, bigint)",
    );
    expect(migration).toContain(
      "drop function public.create_procurement_request_for_new_component(text, uuid, bigint)",
    );
    expect(migration.match(/supplier_id,\n/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/\n    null,\n    p_requested_quantity/g))
      .toHaveLength(2);
  });

  it("keeps reads nullable and creates ProductSupplier only for a known Supplier", () => {
    expect(migration).toContain(
      "left join public.suppliers as supplier\n    on supplier.id = request.supplier_id",
    );
    expect(migration).toContain(
      "if current_request.supplier_id is not null then\n    created_product_supplier_id := public.create_product_supplier",
    );
    expect(migration).toContain(
      "raise exception 'Catalog Number requires a Supplier'\n      using errcode = '22023'",
    );
    expect(migration).toContain(
      "'product_supplier_id', created_product_supplier_id",
    );
  });

  it("preserves trusted authorization and hardened ACL metadata", () => {
    expect(migration.match(/security definer/g)).toHaveLength(4);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(4);
    expect(migration).toContain("public.has_permission('procurement.create')");
    expect(migration).toContain("public.has_permission('procurement.view')");
    expect(migration).toContain(
      "grant execute\n  on function public.create_procurement_request_for_product(uuid, bigint)\n  to authenticated",
    );
    expect(migration).toContain(
      "grant execute\n  on function public.create_procurement_request_for_new_component(text, bigint)\n  to authenticated",
    );
  });
});
