import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261021130000_add_inventory_warehouse_foundation.sql",
), "utf8");

const rawWarehouseId = "10000000-0000-4000-8000-000000000001";
const finishedGoodsWarehouseId = "10000000-0000-4000-8000-000000000002";
const customsWarehouseId = "10000000-0000-4000-8000-000000000003";

describe("Inventory warehouse compatibility foundation migration", () => {
  it("creates exactly the three immutable canonical warehouse identities", () => {
    expect(migration).toContain("create table public.inventory_warehouses");
    expect(migration).toContain(`${rawWarehouseId}', 'raw_materials'`);
    expect(migration).toContain(`${finishedGoodsWarehouseId}', 'finished_goods'`);
    expect(migration).toContain(`${customsWarehouseId}', 'customs'`);
    expect(migration).toContain("inventory_warehouses_canonical_identity");
    expect(migration).toContain("inventory_warehouses_reject_update_delete");
    expect(migration).toContain("alter table public.inventory_warehouses enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("makes balances and provenance warehouse-aware without changing legacy history", () => {
    expect(migration).toContain(
      "add constraint inventory_balances_pkey primary key (product_id, warehouse_id)",
    );
    expect(migration).toContain("inventory_balances_enforce_identity_immutability");
    expect(migration).toContain("inventory_movements_id_product_warehouse_key");
    expect(migration).toContain("inventory_source_lots_id_product_warehouse_key");
    expect(migration).toContain(
      "inventory_source_allocations_outbound_movement_product_warehouse_fkey",
    );
    expect(migration).toContain(
      "inventory_source_allocations_source_lot_product_warehouse_fkey",
    );
    expect(migration).toContain("Historical InventoryMovement parity failed");
    expect(migration).toContain("Historical source-lot parity failed");
    expect(migration).toContain("Historical source-allocation parity failed");
  });

  it("initializes every new Product with three zero balances", () => {
    expect(migration).toContain(
      "create or replace function public.initialize_product_inventory_balance()",
    );
    expect(migration).toContain("from public.inventory_warehouses as warehouse");
    expect(migration).toContain("select new.id, warehouse.id, 0, pg_catalog.now()");
    expect(migration).toContain("Every Product must have exactly three warehouse balances");
    expect(migration).toContain("Future warehouse stock must start at zero");
  });

  it("pins legacy mutations, FIFO, reads, Work Orders, PCB, and shortage logic to Raw Materials", () => {
    const compatibilityFunctions = [
      "public.apply_inventory_delta(uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text)",
      "public.manual_adjust_inventory(uuid,text,bigint,text,uuid)",
      "public.consume_inventory_source_lots(uuid,bigint,uuid)",
      "public.get_work_order_source_allocation_plan(uuid)",
      "public.preflight_finish_work_order(uuid,timestamp with time zone)",
      "public.preflight_finish_pcb_production_work_order(uuid,timestamp with time zone,text)",
      "public.get_dashboard_read_model()",
      "public.get_project_planning(uuid)",
      "public.reconcile_project_shortages_for_products(uuid[],boolean)",
      "public.queue_project_shortage_reconciliation()",
    ];
    for (const signature of compatibilityFunctions) {
      expect(migration).toContain(signature);
    }
    expect(migration.match(new RegExp(rawWarehouseId, "g"))?.length).toBeGreaterThan(30);
    expect(migration).toContain("disable trigger inventory_balances_queue_shortage_reconciliation");
    expect(migration).toContain("enable trigger inventory_balances_queue_shortage_reconciliation");
  });

  it("preserves existing function identities while guarding exact source definitions", () => {
    expect(migration).toContain("create function pg_temp.replace_inventory_function_text");
    expect(migration).toContain("pg_catalog.to_regprocedure(p_signature)");
    expect(migration).toContain("pg_catalog.pg_get_functiondef(function_oid)");
    expect(migration).toContain("if actual_count <> p_expected_count then");
    expect(migration).toContain("execute pg_catalog.replace(definition, p_old, p_new)");
    expect(migration).not.toContain("drop function public.apply_inventory_delta");
  });

  it("keeps existing browser reads Raw-only and all warehouse writes trusted", () => {
    expect(migration).toContain("create policy inventory_balances_select_inventory_readers");
    expect(migration).toContain("create policy inventory_movements_select_inventory_readers");
    expect(migration).toContain(`warehouse_id = '${rawWarehouseId}'::uuid`);
    expect(migration).toContain("public.current_user_is_admin()");
    expect(migration).toContain("public.has_permission('inventory.view')");
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)[\s\S]*inventory_warehouses/i);
  });
});
