import { Link } from "react-router";

import EmptyState from "../../../shared/components/EmptyState";
import type {
  FinishedWorkOrderDetail,
  FinishedWorkOrderMaterial,
  FinishedWorkOrderMovement,
} from "../services/finishedWorkOrderService";
import type { PcbProductionWorkOrderContext } from "../services/pcbProductionWorkOrderService";

interface FinishedWorkOrderViewProps {
  detail: FinishedWorkOrderDetail;
  materials: FinishedWorkOrderMaterial[];
  movements: FinishedWorkOrderMovement[];
  productionContext?: PcbProductionWorkOrderContext | null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-2 whitespace-pre-wrap text-sm font-medium text-zinc-900">
        {value}
      </dd>
    </div>
  );
}

function FinishedWorkOrderView({
  detail,
  materials,
  movements,
  productionContext = null,
}: FinishedWorkOrderViewProps) {
  return (
    <div className="space-y-6">
      {productionContext && <section className="rounded-3xl border border-sky-200 bg-sky-50 p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-zinc-900">PCB production result</h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <ReadOnlyField label="PCB Card" value={productionContext.pcbCardName} />
          <ReadOnlyField label="BOM Version" value={`v${productionContext.bomVersionNumber}`} />
          <ReadOnlyField label="Planned Quantity" value={productionContext.plannedQuantity} />
          <ReadOnlyField label="Actual Completed" value={productionContext.actualGoodQuantity ?? "Not recorded"} />
          <ReadOnlyField label="Output Product" value={`${productionContext.outputSerialNumber} — ${productionContext.outputProductName}`} />
          <ReadOnlyField label="Destination" value={detail.projectName ?? "General Stock"} />
        </dl>
      </section>}
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-zinc-900">Work Order Details</h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2">
          <ReadOnlyField label="Project" value={detail.projectName ?? "General Stock"} />
          <ReadOnlyField label="Customer" value={detail.customerName ?? "Not required"} />
          <ReadOnlyField
            label="Finished Date"
            value={dateTimeFormatter.format(new Date(detail.finishedAt))}
          />
          <ReadOnlyField
            label="Finished By"
            value={detail.finishedByFullName}
          />
          <div className="sm:col-span-2">
            <ReadOnlyField label="Description" value={detail.description} />
          </div>
        </dl>
      </section>

      <section aria-labelledby="finished-materials-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="finished-materials-heading" className="text-xl font-bold text-zinc-900">
          Materials
        </h2>
        {materials.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No materials"
              description="No material rows are recorded for this Finished Work Order."
            />
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200">
                <thead className="bg-zinc-50">
                  <tr>
                    {[
                      "Serial Number",
                      "Product Name",
                      "Quantity",
                    ].map((heading) => (
                      <th key={heading} scope="col" className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {materials.map((material) => (
                    <tr key={material.productId} className="text-sm text-zinc-700">
                      <td className="whitespace-nowrap px-5 py-4 font-mono font-semibold text-zinc-900">
                        {material.serialNumber}
                      </td>
                      <td className="px-5 py-4">{material.productName}</td>
                      <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                        {material.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="finished-movements-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="finished-movements-heading" className="text-xl font-bold text-zinc-900">
          Inventory Movements
        </h2>
        {movements.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No linked Inventory movements"
              description="No Inventory movements are linked to this Finished Work Order."
            />
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200">
                <thead className="bg-zinc-50">
                  <tr>
                    {[
                      "Date",
                      "Serial Number",
                      "Product Name",
                      "Delta",
                      "Before",
                      "After",
                    ].map((heading) => (
                      <th key={heading} scope="col" className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {movements.map((movement) => (
                    <tr key={movement.movementId} className="text-sm text-zinc-700">
                      <td className="whitespace-nowrap px-5 py-4">
                        <time dateTime={movement.createdAt}>
                          {dateTimeFormatter.format(new Date(movement.createdAt))}
                        </time>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 font-mono font-semibold text-zinc-900">
                        {movement.serialNumber}
                      </td>
                      <td className="px-5 py-4">{movement.productName}</td>
                      <td className={`whitespace-nowrap px-5 py-4 font-semibold tabular-nums ${movement.quantityDelta.startsWith("-") ? "text-red-700" : "text-emerald-700"}`}>
                        {movement.quantityDelta}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                        {movement.quantityBefore}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                        {movement.quantityAfter}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="official-pdf-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="official-pdf-heading" className="text-xl font-bold text-zinc-900">
          Official PDF
        </h2>
        {detail.pdf ? (
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-zinc-900">
                Document version {detail.pdf.documentVersion}
              </p>
              <p id="official-pdf-action-help" className="mt-1 text-sm text-zinc-500">
                Opens the authorized PDF viewer in a new browser tab.
              </p>
            </div>
            <Link
              to={`/work-orders/${detail.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby="official-pdf-action-help"
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              Open PDF
            </Link>
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-600">
            No official PDF metadata is available for this Work Order.
          </p>
        )}
      </section>
    </div>
  );
}

export default FinishedWorkOrderView;
