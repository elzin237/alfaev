import {
  LayoutDashboard,
  FolderKanban,
  ShoppingCart,
  Truck,
  Warehouse,
  Cpu,
  ClipboardList,
  CalendarDays,
  Archive,
  Users,
} from "lucide-react";
import type { NavigationItem } from "../types/domain";

export const NAVIGATION = [
  {
    label: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Projects",
    path: "/projects",
    icon: FolderKanban,
  },
  {
    label: "Nabavka",
    path: "/procurement",
    icon: ShoppingCart,
  },
  {
    label: "Dobavljači",
    path: "/suppliers",
    icon: Truck,
  },
  {
    label: "Skladište",
    path: "/inventory",
    icon: Warehouse,
  },
  {
    label: "PCB Cards",
    path: "/pcb",
    icon: Cpu,
  },
  {
    label: "Radni Nalozi",
    path: "/work-orders",
    icon: ClipboardList,
  },
  {
    label: "Calendar",
    path: "/calendar",
    icon: CalendarDays,
  },
  {
    label: "Archive",
    path: "/archive",
    icon: Archive,
  },
  {
    label: "Users",
    path: "/users",
    icon: Users,
  },
] satisfies NavigationItem[];
