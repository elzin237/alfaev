import type { TestCalculationPreview } from "../services/testCalculationPreviewService";

const labels: Record<string,string> = { raw_materials: "Raw Materials", customs: "Customs", finished_goods: "Finished Goods" };
export default function TestCalculationPreviewTable({ preview }: { preview: TestCalculationPreview }) {
  return <section aria-label="Test Calculation preview" className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
    <h3 className="font-bold text-blue-900">Prove Calculation</h3>
    <p className="text-sm text-blue-900">Availability is provisional and will be recalculated when the calculation is saved.</p>
    <p className="text-sm text-zinc-700">One calculation: entered quantities are required totals, not manufacturing multipliers. Available stock is after existing Test holds and applicable Project priority.</p>
    <p className="break-words text-xs text-zinc-600">Server snapshot: <time dateTime={preview.asOf}>{preview.asOf}</time>. No stock is reserved by this preview.</p>
    <div className="overflow-x-auto rounded-xl border border-blue-200 bg-white">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-blue-100 text-blue-950"><tr>{["Component/Product","Quantity per calculation","Required","Available","Reservable","Missing"].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-blue-100">{preview.rows.map(row => <tr key={row.productId}>
          <td className="px-4 py-3"><p className="font-semibold">{row.name}</p><p className="font-mono">{row.serialNumber}</p>
            <details className="mt-2 text-xs text-zinc-600"><summary>Provisional warehouse allocation</summary>
              <ul>{row.warehouses.map(hold => <li key={hold.warehouseId}>{labels[hold.warehouseCode]}: {hold.quantity}</li>)}</ul>
            </details>
          </td>
          {[row.required,row.required,row.available,row.reservable,row.missing].map((quantity,index) =>
            <td key={index} className={`px-4 py-3 font-mono tabular-nums ${index === 4 && quantity !== "0" ? "font-semibold text-red-700" : "text-zinc-800"}`}>{quantity}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
