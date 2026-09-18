import { useState } from "react";
import EmptyState from "../../../shared/components/EmptyState";
import { buildPcbProductionPreview } from "../domain/buildPcbProductionPreview";
import type { PcbProductionProjectChoice, PcbProductionSource } from "../services/pcbProductionPrecheckService";

interface Props {
  source: PcbProductionSource;
  projects: PcbProductionProjectChoice[];
}

const statusLabels = { planned: "Planned", in_progress: "In Progress", on_hold: "On Hold" };

export default function PcbProductionPrecheckForm({ source, projects }: Props) {
  const [quantity, setQuantity] = useState("");
  const [projectId, setProjectId] = useState("");
  const preview = quantity === "" ? null : buildPcbProductionPreview(source.inputs, quantity, source.outputIsActive);

  return <div className="space-y-6">
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-zinc-800">Quantity to Produce
          <input type="text" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2" aria-describedby="quantity-help" />
        </label>
        <label className="block text-sm font-semibold text-zinc-800">Project (optional)
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2">
            <option value="">No Project / General stock</option>
            {projects.map((project) => <option key={project.projectId} value={project.projectId}>
              {project.name} — {statusLabels[project.status]}
            </option>)}
          </select>
        </label>
      </div>
      <p id="quantity-help" className="mt-3 text-sm text-zinc-500">
        Enter a positive whole number to preview requirements. Stock may change before production.
      </p>
    </section>

    {!source.outputIsActive && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      The PCB output Product is archived and unavailable for production.
    </p>}
    {source.inputs.length === 0 && <EmptyState title="No BOM inputs" description="The active BOM has no input Products." />}
    {!preview && source.inputs.length > 0 && <EmptyState title="Enter quantity" description="Requirements will appear after you enter Quantity to Produce." />}
    {preview && !preview.ok && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {preview.code === "overflow" ? "Required quantity exceeds the supported whole-number range."
        : preview.code === "invalid_source" ? "Inventory quantity could not be verified."
          : "Enter a positive whole-number quantity within the supported range."}
    </p>}
    {preview?.ok && source.inputs.length > 0 && <section className="space-y-4">
      <h2 className="text-lg font-bold text-zinc-900">Requirements</h2>
      <div className="overflow-x-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600"><tr>
            <th className="px-5 py-4">Component</th><th className="px-5 py-4">Qty per Card</th>
            <th className="px-5 py-4">Required</th><th className="px-5 py-4">Available</th>
            <th className="px-5 py-4">Missing</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">{preview.rows.map((row) =>
            <tr key={row.productId} className={row.missingQuantity !== "0" || !row.isActive ? "bg-amber-50" : ""}>
              <td className="px-5 py-4 font-semibold">{row.name} <span className="font-mono text-xs text-zinc-500">{row.serialNumber}</span>
                {!row.isActive && <span className="ml-2 text-amber-900">Archived / unavailable</span>}</td>
              <td className="px-5 py-4">{row.quantityPerCard}</td><td className="px-5 py-4">{row.requiredQuantity}</td>
              <td className="px-5 py-4">{row.availableQuantity}</td><td className="px-5 py-4">{row.missingQuantity}</td>
            </tr>)}</tbody>
        </table>
      </div>
      {preview.insufficient && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Production cannot be completed because Inventory is insufficient.
      </p>}
      {preview.ready && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Current physical stock meets the previewed requirements. Final stock will be checked during production.
      </p>}
    </section>}
  </div>;
}
