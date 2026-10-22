import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261021150000_add_finished_product_calculator_serials.sql",
), "utf8");

describe("Finished Product Calculator Serial migration", () => {
  it("widens Product identity to exact three- or seven-digit ASCII text without weakening uniqueness", () => {
    expect(migration).toContain(
      "check (serial_number ~ '^([0-9]{3}|[0-9]{7})$')",
    );
    expect(migration).not.toContain("drop constraint products_serial_number_key");
    expect(migration).not.toContain("alter column serial_number type");
  });

  it("preflights and enforces case-insensitive finished-product Name/Code uniqueness", () => {
    expect(migration).toContain("group by pg_catalog.lower(card.name)");
    expect(migration).toContain("having pg_catalog.count(*) > 1");
    expect(migration).toContain(
      "create unique index pcb_cards_name_ci_key\n  on public.pcb_cards (pg_catalog.lower(name))",
    );
    expect(migration).toContain("using errcode = 'PCB14'");
  });

  it("replaces the old creation overload with the trusted manual three-digit contract", () => {
    expect(migration).toContain("drop function public.create_pcb_card(text)");
    expect(migration).toContain("create function public.create_pcb_card(\n  p_name text,\n  p_serial_number text");
    expect(migration).toContain("p_serial_number ~ '^[0-9]{3}$'");
    expect(migration).not.toContain("public.allocate_product_serial_number()");
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to authenticated");
  });

  it("keeps creation atomic with global Serial conflict mapping, three warehouse balances, and audits", () => {
    expect(migration).toContain("violated_constraint = CONSTRAINT_NAME");
    expect(migration).toContain("violated_constraint = 'products_serial_number_key'");
    expect(migration).toContain("using errcode = 'PRD06'");
    expect(migration).toContain("insert into public.products as inserted");
    expect(migration).toContain("insert into public.pcb_cards as inserted");
    expect(migration).toContain("Product trigger creates one zero balance for each canonical warehouse");
    expect(migration).toContain("p_action_type => 'product.created'");
    expect(migration).toContain("p_action_type => 'pcb_card.created'");
  });

  it("accepts both supported Serial lengths at the trusted Work Order resolver", () => {
    expect(migration).toContain(
      "create or replace function public.resolve_work_order_product_barcode(",
    );
    expect(migration).toContain(
      "p_serial_number ~ '^([0-9]{3}|[0-9]{7})$'",
    );
    expect(migration).toContain("Enter a 3- or 7-digit Serial Number");
  });

  it("renames only permission labels while retaining technical PCB keys", () => {
    expect(migration).toContain("View Finished Product Calculator");
    for (const key of ["pcb.view", "pcb.create", "pcb.edit", "pcb.produce", "pcb.archive"]) {
      expect(migration).toContain(`'${key}'`);
    }
    expect(migration).not.toContain("insert into public.permission_definitions");
  });
});
