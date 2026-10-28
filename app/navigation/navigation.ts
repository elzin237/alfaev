import {
  LayoutDashboard,
  FolderKanban,
  ShoppingCart,
  Truck,
  Warehouse,
  Cpu,
  ClipboardList,
  FileText,
  PackageCheck,
  CalendarDays,
  Archive,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PermissionKey } from "../auth/permissions";

export type NavigationAccess =
  | { kind: "permission"; permission: PermissionKey }
  | { kind: "any-permission"; permissions: readonly PermissionKey[] }
  | { kind: "authenticated" }
  | { kind: "admin" };

export interface AuthorizedNavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
  access: NavigationAccess;
}

export const NAVIGATION = [
  {
    label: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
    access: { kind: "permission", permission: "dashboard.view" },
  },
  {
    label: "Projects",
    path: "/projects",
    icon: FolderKanban,
    access: { kind: "permission", permission: "projects.view" },
  },
  {
    label: "Procurement",
    path: "/procurement",
    icon: ShoppingCart,
    access: { kind: "permission", permission: "procurement.view" },
  },
  {
    label: "Suppliers",
    path: "/suppliers",
    icon: Truck,
    access: { kind: "permission", permission: "suppliers.view" },
  },
  {
    label: "Inventory",
    path: "/inventory",
    icon: Warehouse,
    access: {
      kind: "any-permission",
      permissions: [
        "inventory.raw_materials.view",
        "inventory.finished_goods.view",
        "inventory.customs.view",
      ],
    },
  },
  {
    label: "Product Calculator",
    path: "/pcb",
    icon: Cpu,
    access: { kind: "permission", permission: "pcb.view" },
  },
  {
    label: "Work Orders",
    path: "/work-orders",
    icon: ClipboardList,
    access: { kind: "permission", permission: "work_orders.view" },
  },
  {
    label: "Documentation",
    path: "/documents",
    icon: FileText,
    access: { kind: "admin" },
  },
  {
    label: "Fixed Assets",
    path: "/fixed-assets",
    icon: PackageCheck,
    access: { kind: "admin" },
  },
  {
    label: "Calendar",
    path: "/calendar",
    icon: CalendarDays,
    access: { kind: "authenticated" },
  },
  {
    label: "Archive",
    path: "/archive",
    icon: Archive,
    access: { kind: "permission", permission: "archive.view" },
  },
  {
    label: "Users",
    path: "/users",
    icon: Users,
    access: { kind: "admin" },
  },
] satisfies AuthorizedNavigationItem[];
