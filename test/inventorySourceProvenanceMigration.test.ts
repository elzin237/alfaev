import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const foundationPath = resolve(process.cwd(), "supabase/migrations/20261013100000_add_inventory_source_lot_foundation.sql");
const operationsPath = resolve(process.cwd(), "supabase/migrations/20261013103000_add_lot_aware_inventory_operations.sql");
const finishPath = resolve(process.cwd(), "supabase/migrations/20261013110000_bind_work_order_finish_to_source_allocations.sql");
const foundation = readFileSync(foundationPath, "utf8");
const operations = readFileSync(operationsPath, "utf8");
const finish = readFileSync(finishPath, "utf8");

describe("Supplier Catalog provenance migrations", () => {
  it("blocks unresolved active null Catalog Numbers and adds normalized optional description", () => {
    expect(foundation).toContain("where relationship.is_active\n      and relationship.catalog_number is null");
    expect(foundation).toContain("using errcode = 'PSR05'");
    expect(foundation).toContain("add column description text");
    expect(foundation).toContain("check (not is_active or catalog_number is not null)");
    expect(foundation).not.toMatch(/coalesce\([^)]*catalog_number[^)]*['\"][^'\"]+['\"]\)/i);
    expect(operations).toContain("raise exception 'Catalog Number is required'");
    expect(operations).toContain("normalized_description := nullif(pg_catalog.btrim(p_description), '')");
  });

  it("creates narrow immutable lot and allocation schemas with trusted-only access", () => {
    expect(foundation).toContain("create table public.inventory_source_lots");
    expect(foundation).toContain("source_kind in ('supplier', 'legacy_unknown', 'internal_production')");
    expect(foundation).toContain("remaining_quantity <= received_quantity");
    expect(foundation).toContain("foreign key (product_supplier_id, product_id)");
    expect(foundation).toContain("create table public.inventory_source_allocations");
    expect(foundation).toContain("unique (outbound_inventory_movement_id, source_lot_id)");
    expect(foundation).toContain("foreign key (source_lot_id, product_id)");
    expect(foundation).toContain("foreign key (outbound_inventory_movement_id, product_id)");
    expect(foundation).toContain("foreign key (originating_inventory_movement_id, product_id)");
    expect(foundation).toContain("allocated_quantity <> (received_quantity - remaining_quantity)::numeric");
    expect(foundation).toContain("Inventory source lots cannot be deleted");
    expect(foundation).toContain("Inventory source allocations are immutable");
    expect(foundation).toContain("revoke all privileges on table public.inventory_source_lots");
    expect(foundation).toContain("revoke all privileges on table public.inventory_source_allocations");
    expect(foundation).not.toMatch(/grant (insert|update|delete).*inventory_source/si);
  });

  it("backfills only positive balances as truthful legacy unknown stock", () => {
    expect(foundation).toContain("'legacy_unknown'");
    expect(foundation).toContain("balance.quantity,\n  balance.quantity");
    expect(foundation).toContain("where balance.quantity > 0");
    expect(foundation).toContain("do not claim a historical receipt date");
    expect(foundation).not.toMatch(/update public\.inventory_movements/i);
  });

  it("enforces aggregate balance equality at transaction end", () => {
    expect(foundation.match(
      /create function public\.check_inventory_source_lot_(?:balance|allocation_accounting)\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/g,
    )).toHaveLength(2);
    expect(foundation).toContain(
      "revoke all privileges\n  on function public.check_inventory_source_lot_balance()\n  from public, anon, authenticated",
    );
    expect(foundation).toContain(
      "revoke all privileges\n  on function public.check_inventory_source_lot_allocation_accounting()\n  from public, anon, authenticated",
    );
    expect(foundation).toContain("sum(lot.remaining_quantity::numeric)");
    expect(foundation).toContain("lot_quantity <> balance_quantity::numeric");
    expect(foundation).toContain("deferrable initially deferred");
    expect(foundation.match(/check_inventory_source_lot_balance\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("requires exact inbound ProductSupplier and allocates every outbound delta FIFO", () => {
    expect(operations).toContain("p_product_supplier_id uuid default null");
    expect(operations).toContain("p_inventory_source_kind text default null");
    expect(operations).toContain("relationship.product_id <> p_product_id");
    expect(operations).toContain("not source_supplier.is_active");
    expect(operations).toContain("order by lot.received_at, lot.id\n    for update");
    expect(operations).toContain("least(lot_record.remaining_quantity, remaining_to_allocate)");
    expect(operations).toContain("perform public.consume_inventory_source_lots");
    expect(operations).toContain("'internal_production'");
    expect(operations).toContain("normalized_source_type = 'pcb_production_output'");
  });

  it("removes the supplier-free browser adjustment overload", () => {
    expect(operations).toContain("drop function public.manual_adjust_inventory(uuid, text, bigint, text)");
    expect(operations).toContain("p_product_supplier_id uuid");
    expect(operations).toContain("quantity_delta > 0 and p_product_supplier_id is null");
    expect(operations).toContain("quantity_delta < 0 and p_product_supplier_id is not null");
    expect(operations).toContain("perform 1\n  from public.user_profiles as profile");
    expect(operations).toContain("grant execute on function public.manual_adjust_inventory(uuid, text, bigint, text, uuid)");
  });

  it("binds PDF rows and Finish to one recomputed allocation fingerprint", () => {
    expect(finish).toContain("create function public.get_work_order_source_allocation_plan");
    expect(finish).toContain("order by lot.received_at, lot.id\n    for update");
    expect(finish).toContain("get_work_order_source_allocation_fingerprint");
    expect(finish.match(/from trusted_header as header\n    cross join lateral public\.get_work_order_source_allocation_plan/g)?.length).toBe(2);
    expect(finish).toContain("p_allocation_fingerprint text");
    expect(finish).toContain("current_fingerprint is distinct from p_allocation_fingerprint");
    expect(finish).toContain("using errcode = 'WOR11'");
    expect(finish).toContain("finish_generic_work_order_internal");
    expect(finish).toContain("finish_pcb_work_order_internal");
    expect(finish).toContain("coalesce(plan.catalog_number_snapshot, '—')");
    expect(finish).not.toContain("plan.serial_number");
  });

  it("returns immutable split-source Finished material history", () => {
    expect(finish).toContain("result.allocated_quantity::text");
    expect(finish).toContain("lot.supplier_name_snapshot");
    expect(finish).toContain("lot.catalog_number_snapshot");
    expect(finish).toContain("lot.supplier_description_snapshot");
    expect(finish).toContain("movement.source_type = 'pcb_production_input'");
    expect(finish).toContain("historical_unattributed_rows as materialized");
    expect(finish).toContain("'legacy_unknown'::text as source_kind");
    expect(finish).toContain("from public.work_order_items as item");
  });
});
