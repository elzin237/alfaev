import type { LucideIcon } from "lucide-react";

export type DashboardStatVariant = "light" | "dark";

export interface DashboardStat {
  id: number;
  title: string;
  value: number;
  icon: LucideIcon;
  variant: DashboardStatVariant;
}

export type ProjectPhase =
  | "Projektovanje"
  | "Nabavka"
  | "Izrada"
  | "Montaža"
  | "Testiranje"
  | "Isporuka";

export interface Project {
  id: string;
  name: string;
  client: string;
  progress: number;
  status: ProjectPhase;
  deliveryDate: string;
  image: string;
  step: number;
}

export type PhaseStatus = "completed" | "active" | "pending";

export type AlertLevel = "critical" | "document" | "task";

export interface Alert {
  id: number;
  title: string;
  description: string;
  meta: string;
  level: AlertLevel;
  time: string;
}

export type InventoryStatus = "Kritično" | "Nedovoljno" | "U redu";

export interface InventoryItem {
  id: number;
  item: string;
  stock: number;
  minimum: number;
  status: InventoryStatus;
}

export interface RecentActivity {
  id: number;
  user: string;
  action: string;
  target: string;
  time: string;
}

export type WorkOrderPriority = "Visok" | "Srednji";
export type WorkOrderStatus = "U toku" | "Planiran" | "Na čekanju";

export interface WorkOrder {
  id: string;
  project: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
}

export type ProcurementRequestStatus =
  | "Na odobrenju"
  | "Poslano"
  | "Priprema";

export interface ProcurementRequest {
  id: string;
  supplier: string;
  value: string;
  status: ProcurementRequestStatus;
}
