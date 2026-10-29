import { CheckCircle2 } from "lucide-react";

import type { FinishedWorkOrderDetail } from "../services/finishedWorkOrderService";
import type { PcbProductionWorkOrderContext } from "../services/pcbProductionWorkOrderService";

function CompletionField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm font-medium leading-6 text-zinc-900 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

// Saved completion data only: quantities are displayed losslessly, not recalculated.
export default function FinishedPcbProductionSummary({ detail, productionContext, finishedDate }: {
  detail: FinishedWorkOrderDetail;
  productionContext: PcbProductionWorkOrderContext;
  finishedDate: string;
}) {
  return (
    <>
      <section aria-label="Production Result" className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Production Result</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 [overflow-wrap:anywhere] sm:text-3xl">{productionContext.pcbCardName}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500 [overflow-wrap:anywhere]">
              <span className="sr-only">Output Product: </span>
              <span className="font-mono font-semibold text-zinc-700">{productionContext.outputSerialNumber}</span>
              <span aria-hidden="true" className="mx-2 text-zinc-300">/</span>
              {productionContext.outputProductName}
            </p>
          </div>
          <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            Completed
          </span>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 sm:p-5">
            <dt className="text-sm font-medium text-zinc-500">Planned Quantity</dt>
            <dd className="mt-2 text-3xl font-semibold tracking-tight text-zinc-700 tabular-nums [overflow-wrap:anywhere] sm:text-4xl">{productionContext.plannedQuantity}</dd>
          </div>
          <div className="min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 sm:p-5">
            <dt className="text-sm font-semibold text-emerald-800">Actual Completed</dt>
            <dd className="mt-2 text-3xl font-bold tracking-tight text-emerald-900 tabular-nums [overflow-wrap:anywhere] sm:text-4xl">{productionContext.actualGoodQuantity ?? "Not recorded"}</dd>
          </div>
        </dl>

        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-zinc-100 pt-4 sm:grid-cols-2">
          <CompletionField label="Destination" value={detail.projectName ?? "General Stock"} />
          <CompletionField label="BOM Version" value={`v${productionContext.bomVersionNumber}`} />
        </dl>
      </section>

      <section aria-labelledby="completion-details-heading" className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 id="completion-details-heading" className="text-base font-bold text-zinc-900">Completion Details</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Finished Date</dt>
            <dd className="mt-1 text-sm font-medium leading-6 text-zinc-900"><time dateTime={detail.finishedAt}>{finishedDate}</time></dd>
          </div>
          <CompletionField label="Finished By" value={detail.finishedByFullName} />
          <CompletionField label="Project" value={detail.projectName ?? "General Stock"} />
          <CompletionField label="Customer" value={detail.customerName ?? "Not required"} />
          <div className="min-w-0 border-t border-zinc-100 pt-3 sm:col-span-2 xl:col-span-4">
            <CompletionField label="Description" value={detail.description} />
          </div>
        </dl>
      </section>
    </>
  );
}
