import {
  LayoutDashboard,
  FolderKanban,
  ShoppingCart,
  Truck,
  Warehouse,
  Cpu,
  ClipboardList,
  FileText,
  CalendarDays,
  Archive,
  Users,
} from "lucide-react";
import type { PermissionKey } from "../auth/permissions";
import type { NavigationItem } from "../../lib/types/domain";

export type NavigationAccess =
  | { kind: "permission"; permission: PermissionKey }
  | { kind: "authenticated" }
  | { kind: "admin" };

export type AuthorizedNavigationItem = NavigationItem & {
  access: NavigationAccess;
};

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
    label: "Nabavka",
    path: "/procurement",
    icon: ShoppingCart,
    access: { kind: "permission", permission: "procurement.view" },
  },
  {
    label: "Dobavljači",
    path: "/suppliers",
    icon: Truck,
    access: { kind: "permission", permission: "suppliers.view" },
  },
  {
    label: "Skladište",
    path: "/inventory",
    icon: Warehouse,
    access: { kind: "permission", permission: "inventory.view" },
  },
  {
    label: "PCB Cards",
    path: "/pcb",
    icon: Cpu,
    access: { kind: "permission", permission: "pcb.view" },
  },
  {
    label: "Radni Nalozi",
    path: "/work-orders",
    icon: ClipboardList,
    access: { kind: "permission", permission: "work_orders.view" },
  },
  {
    label: "Dokumentacija",
    path: "/documents",
    icon: FileText,
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
