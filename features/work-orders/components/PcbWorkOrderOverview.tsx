import StatusBadge from "../../../shared/components/StatusBadge";
import type { PcbProductionWorkOrderContext } from "../services/pcbProductionWorkOrderService";
import type { WorkOrderDetail } from "../services/workOrderService";

function OverviewField({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
    <dd className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-zinc-900 [overflow-wrap:anywhere]">{value ?? "Not set"}</dd>
  </div>;
}

// Presentation only: the frozen production context and saved Draft remain the
// authoritative inputs. No editable state, availability or quantity calculations.
export default function PcbWorkOrderOverview({ workOrder, productionContext }: {
  workOrder: WorkOrderDetail;
  productionContext: PcbProductionWorkOrderContext;
}) {
  return <section aria-label="Work Order overview" className="min-w-0 rounded-3xl border border-zinc-200 border-t-2 border-t-sky-300 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">PCB Production · Work Order Overview</p>
        <h2 className="mt-2 min-w-0 text-2xl font-bold tracking-tight text-zinc-900 [overflow-wrap:anywhere] sm:text-3xl">{productionContext.pcbCardName}</h2>
        <p className="mt-1 text-xs text-zinc-500">Finished Product</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span title={`BOM Version ${productionContext.bomVersionNumber}`}><StatusBadge label={`BOM v${productionContext.bomVersionNumber}`} tone="info" /></span>
        <StatusBadge label={workOrder.status === "draft" ? "Draft" : "Finished"} tone={workOrder.status === "draft" ? "neutral" : "success"} />
      </div>
    </div>
    <dl className="mt-4 grid min-w-0 gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <OverviewField label="Planned Quantity" value={productionContext.plannedQuantity} />
      <OverviewField label="Output Product" value={`${productionContext.outputSerialNumber} — ${productionContext.outputProductName}`} />
      <OverviewField label="Destination" value={workOrder.projectName ?? "General Stock"} />
    </dl>
    <dl className="mt-4 grid min-w-0 gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
      <OverviewField label="Project" value={workOrder.projectName ?? "Not selected"} />
      <OverviewField label="Customer" value={workOrder.customerName} />
      <div className="min-w-0 sm:col-span-2 lg:col-span-1"><OverviewField label="Short Description" value={workOrder.description} /></div>
    </dl>
    <p className="mt-4 border-t border-zinc-200 pt-3 text-sm leading-6 text-zinc-600">The production plan and BOM materials are locked. Additional materials may be added to the Draft.</p>
  </section>;
}
