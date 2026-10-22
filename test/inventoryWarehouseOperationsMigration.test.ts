import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261021140000_add_warehouse_permissions_and_operations.sql",
), "utf8");

const warehousePermissions = [
  "inventory.raw_materials.view",
  "inventory.raw_materials.adjust",
  "inventory.finished_goods.view",
  "inventory.finished_goods.adjust",
  "inventory.customs.view",
  "inventory.customs.adjust",
];

const browserFunctions = [
  "search_inventory_products_by_warehouse(uuid, text)",
  "get_inventory_product_by_warehouse(uuid, uuid)",
  "list_active_inventory_source_choices_by_warehouse(uuid, uuid)",
  "get_inventory_stock_availability_by_warehouse(uuid, uuid)",
  "get_inventory_movements_for_product_by_warehouse(uuid, uuid)",
  "list_inventory_source_lots_by_warehouse(uuid, uuid)",
  "adjust_inventory_warehouse(uuid, uuid, text, bigint, text, uuid)",
  "transfer_inventory_between_warehouses(uuid, uuid, uuid, bigint, text)",
];

describe("Inventory warehouse permissions and operations migration", () => {
  it("adds exactly the six independently delegable warehouse permissions", () => {
    for (const permission of warehousePermissions) {
      expect(migration).toContain(`'${permission}'`);
    }
    expect(new Set(warehousePermissions).size).toBe(6);
    expect(migration).not.toContain("inventory.all_warehouses");
  });

  it("migrates legacy inventory.view grants only to Raw Materials view", () => {
    expect(migration).toContain("legacy_definition.key = 'inventory.view'");
    expect(migration).toContain(
      "raw_view_definition.key = 'inventory.raw_materials.view'",
    );
    expect(migration).toContain("where not profile.is_admin");
    expect(migration).toContain("legacy_grant.granted_by_user_id");
    expect(migration).not.toMatch(
      /legacy_definition\.key = 'inventory\.view'[\s\S]*raw_view_definition\.key = 'inventory\.(finished_goods|customs)/,
    );
  });

  it("defines exact warehouse-scoped trusted read and mutation boundaries", () => {
    for (const signature of browserFunctions) {
      expect(migration).toContain(`public.${signature}`);
    }
    expect(migration).toContain("public.inventory_warehouse_permission_key(");
    expect(migration).toContain("p_warehouse_id, 'view'");
    expect(migration).toContain("p_warehouse_id, 'adjust'");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("adds narrow source choices and a complete warehouse Product detail projection", () => {
    expect(migration).toContain(
      "create function public.list_active_inventory_source_choices_by_warehouse(",
    );
    expect(migration).toContain("p_warehouse_id, 'adjust'");
    expect(migration).toContain("and relationship.is_active");
    expect(migration).toContain("and supplier.is_active");
    expect(migration).toContain("and supplier.catalog_number is not null");
    expect(migration).toContain("brand_id uuid");
    expect(migration).toContain("brand_is_active boolean");
    expect(migration).toContain("created_at timestamptz");
    expect(migration).toContain("archived_at timestamptz");
    expect(migration).toContain("balance_updated_at timestamptz");
    expect(migration).toContain("product.updated_at");
    expect(migration).toContain("balance.updated_at");
    expect(migration).not.toContain(
      "create or replace function public.list_active_inventory_source_choices(",
    );
  });

  it("records immutable paired transfer movements and preserved lot provenance", () => {
    expect(migration).toContain("create table public.inventory_warehouse_transfers");
    expect(migration).toContain("inventory_warehouse_transfers_outbound_context_fkey");
    expect(migration).toContain("inventory_warehouse_transfers_inbound_context_fkey");
    expect(migration).toContain("'warehouse_transfer_out'");
    expect(migration).toContain("'warehouse_transfer_in'");
    expect(migration).toContain("'warehouse_transfer', p_quantity_delta");
    expect(migration).toContain("inventory_warehouse_transfers_reject_update_delete");
    expect(migration).toContain("order by balance.warehouse_id");
    expect(migration).toContain("order by lot.received_at, lot.id");
  });

  it("keeps internal mutation primitives unavailable to browser roles", () => {
    expect(migration).toContain(
      "public.apply_inventory_delta_in_warehouse(\n    uuid, uuid, bigint, text, text, text, uuid, uuid, uuid, uuid, text\n  ) from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "public.consume_inventory_source_lots_in_warehouse(uuid, uuid, bigint, uuid)\n  from public, anon, authenticated, service_role",
    );
    expect(migration).not.toContain(
      "grant execute on function public.apply_inventory_delta_in_warehouse",
    );
  });

  it("does not alter legacy production allocation contracts", () => {
    for (const name of [
      "finish_work_order",
      "produce_pcb",
      "finish_pcb_production_work_order",
      "reconcile_project_shortages_for_products",
    ]) {
      expect(migration).not.toContain(`create or replace function public.${name}`);
    }
  });
});
