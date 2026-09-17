import { useState } from "react";
import { Link } from "react-router";
import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import CreatePcbCardDialog from "./components/CreatePcbCardDialog";
import { usePcbCards } from "./hooks/usePcbCards";
import { usePcbCreation } from "./hooks/usePcbCreation";

export default function PcbPage() {
  const cardsQuery = usePcbCards();
  const { canCreate, create } = usePcbCreation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="PCB Cards" description="PCB card definitions and their output Products."
        actions={canCreate ? <button type="button" onClick={() => { setSuccess(null); setDialogOpen(true); }}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Create PCB Card</button> : undefined} />
      {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>}
      {cardsQuery.isPending ? <LoadingState message="Loading PCB Cards..." /> :
        cardsQuery.isError || !cardsQuery.data?.ok ?
          <ErrorState title="Unable to load PCB Cards"
            message={cardsQuery.data?.ok === false ? cardsQuery.data.error.message : "PCB Cards could not be loaded."}
            onRetry={() => void cardsQuery.refetch()} /> :
        cardsQuery.data.value.length === 0 ?
          <EmptyState title="No PCB Cards found" description="There are no PCB Cards to display." /> :
          <div className="overflow-x-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
                <tr><th className="px-5 py-4">Name / Code</th><th className="px-5 py-4">Output Serial</th>
                  <th className="px-5 py-4">Current Stock</th><th className="px-5 py-4">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {cardsQuery.data.value.map((card) => <tr key={card.id}>
                  <td className="px-5 py-4 font-semibold text-zinc-900"><Link to={`/pcb/${card.id}`}
                    className="hover:text-red-700 hover:underline">{card.name}</Link></td>
                  <td className="px-5 py-4 font-mono text-zinc-700">{card.serialNumber}</td>
                  <td className="px-5 py-4 text-zinc-700">{card.currentStock}</td>
                  <td className="px-5 py-4"><StatusBadge label={card.isActive ? "Active" : "Archived"}
                    tone={card.isActive ? "success" : "neutral"} /></td>
                </tr>)}
              </tbody>
            </table>
          </div>}
      {dialogOpen && <CreatePcbCardDialog onClose={() => setDialogOpen(false)} onSubmit={create}
        onCreated={(created) => setSuccess(`PCB Card created. Serial Number: ${created.serialNumber}`)} />}
    </div>
  );
}
