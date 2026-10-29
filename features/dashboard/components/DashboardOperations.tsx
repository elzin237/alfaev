import type { DashboardReadModel } from "../services/dashboardService";
import type { ReactNode } from "react";
import DashboardActivity from "./DashboardActivity";
import DashboardCalendar from "./DashboardCalendar";
import DashboardProcurement from "./DashboardProcurement";
import DashboardProjects from "./DashboardProjects";
import DashboardStockHealthPanels from "./DashboardStockHealthPanels";
import DashboardWorkOrders from "./DashboardWorkOrders";

function GridCard({ children, fullOnTablet = false }: { children: ReactNode; fullOnTablet?: boolean }) {
  return <div className={`min-h-0 min-w-0 [&>section]:h-full ${fullOnTablet ? "@2xl:col-span-full" : ""} @5xl:col-span-4 @5xl:row-span-3`}>
    {children}
  </div>;
}

export default function DashboardOperations({ data }: { data: DashboardReadModel }) {
  return <DashboardStockHealthPanels unified legacyInventory={data.inventory} renderPanels={(inventoryHealth) => {
    return <div className="space-y-4">
      <div aria-label="Operations overview" className="grid min-w-0 grid-flow-row-dense items-stretch gap-4 @2xl:grid-cols-2 @5xl:grid-cols-12 @5xl:auto-rows-[140px]">
      {data.projects && <GridCard><DashboardProjects section={data.projects} /></GridCard>}
      {data.workOrders && <GridCard><DashboardWorkOrders section={data.workOrders} /></GridCard>}
      {data.procurement && <GridCard fullOnTablet={Boolean(data.projects && data.workOrders)}>
        <div className="h-full min-h-0 min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm [&>section]:h-full">
          <DashboardProcurement section={data.procurement} compact />
        </div>
      </GridCard>}
      </div>
      {inventoryHealth}
      <div aria-label="Calendar and recent activity" className={`grid min-w-0 items-stretch gap-4 ${data.activity ? "@2xl:grid-cols-2" : ""} @2xl:[&>section]:h-72`}>
        <DashboardCalendar section={data.calendar} compact />
        <DashboardActivity section={data.activity} compact />
      </div>
    </div>;
  }} />;
}
