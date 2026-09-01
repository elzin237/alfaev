import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  ShoppingCart,
  Warehouse,
  Factory,
  Cpu,
  ClipboardList,
  ShieldCheck,
  BarChart3,
  Users,
  Settings,
} from "lucide-react";

export const NAVIGATION = [
  {
    label: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Projekti",
    path: "/projects",
    icon: FolderKanban,
  },
  {
    label: "Dokumentacija",
    path: "/documents",
    icon: FileText,
  },
  {
    label: "Nabavka",
    path: "/procurement",
    icon: ShoppingCart,
  },
  {
    label: "Skladište",
    path: "/inventory",
    icon: Warehouse,
  },
  {
    label: "Proizvodnja",
    path: "/production",
    icon: Factory,
  },
  {
    label: "PCB Kartice",
    path: "/pcb",
    icon: Cpu,
  },
  {
    label: "Radni Nalozi",
    path: "/work-orders",
    icon: ClipboardList,
  },
  {
    label: "Kontrola Kvaliteta",
    path: "/quality",
    icon: ShieldCheck,
  },
  {
    label: "Izvještaji",
    path: "/reports",
    icon: BarChart3,
  },
  {
    label: "Korisnici",
    path: "/users",
    icon: Users,
  },
  {
    label: "Postavke",
    path: "/settings",
    icon: Settings,
  },
];
