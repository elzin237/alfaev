const moduleLabels: Readonly<Record<string, string>> = {
  brand: "Inventory",
  calendar_entry: "Calendar",
  documentation_record: "Documentation",
  fixed_asset: "Fixed Asset",
  inventory_balance: "Inventory",
  inventory_movement: "Inventory",
  pcb_bom_version: "PCB",
  pcb_card: "PCB",
  pcb_production: "PCB",
  pcb_production_run: "PCB",
  permission: "Permissions",
  procurement: "Procurement",
  procurement_request: "Procurement",
  product: "Product",
  product_inventory: "Inventory",
  product_supplier: "Product Supplier",
  project: "Project",
  project_product: "Project",
  project_product_component: "Project",
  supplier: "Supplier",
  user: "User",
  user_permission: "Permissions",
  user_profile: "User",
  work_order: "Work Order",
};

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._\-/\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || "Unknown";
}

export function formatArchiveModule(entityType: string): string {
  return moduleLabels[entityType] ?? humanize(entityType);
}

export function formatArchiveAction(actionType: string): string {
  const segments = actionType.split(".").filter(Boolean);
  const segment = segments[segments.length - 1] ?? actionType;
  return humanize(segment);
}

export function formatArchiveDateTime(
  createdAt: string,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(createdAt));
}

export function compactArchiveRecordId(entityId: string): string {
  return `${entityId.slice(0, 8)}…${entityId.slice(-4)}`;
}
