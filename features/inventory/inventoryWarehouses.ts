import type { PermissionKey } from "../../app/auth/permissions";

export type InventoryWarehouseCode =
  | "raw_materials"
  | "finished_goods"
  | "customs";

export interface InventoryWarehouse {
  id: string;
  code: InventoryWarehouseCode;
  label: string;
  viewPermission: PermissionKey;
  adjustPermission: PermissionKey;
}

export const INVENTORY_WAREHOUSES: readonly InventoryWarehouse[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    code: "raw_materials",
    label: "Raw Materials",
    viewPermission: "inventory.raw_materials.view",
    adjustPermission: "inventory.raw_materials.adjust",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    code: "finished_goods",
    label: "Finished Goods",
    viewPermission: "inventory.finished_goods.view",
    adjustPermission: "inventory.finished_goods.adjust",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    code: "customs",
    label: "Customs Warehouse",
    viewPermission: "inventory.customs.view",
    adjustPermission: "inventory.customs.adjust",
  },
] as const;

export function findInventoryWarehouse(code: string | null) {
  return INVENTORY_WAREHOUSES.find((warehouse) => warehouse.code === code);
}

