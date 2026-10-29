import { Warehouse } from "lucide-react";
import type { ReactNode } from "react";
import DashboardSectionHeader from "./DashboardSectionHeader";

export default function DashboardInventoryHealth({ overview, attention, inventoryTo }: {
  overview: ReactNode;
  attention: ReactNode;
  inventoryTo: string;
}) {
  return <section aria-labelledby="dashboard-inventory-health-title" className="@container/health min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm">
    <DashboardSectionHeader icon={Warehouse} title="Inventory Health" titleId="dashboard-inventory-health-title" actionLabel="View inventory" actionTo={inventoryTo} />
    <div className={`grid min-w-0 items-stretch ${attention ? "@3xl/health:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
      <div className="min-w-0 pb-4">{overview}</div>
      {attention && <div className="min-w-0 border-t border-zinc-200/70 pb-4 @3xl/health:border-t-0 @3xl/health:border-l">{attention}</div>}
    </div>
  </section>;
}
