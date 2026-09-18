import { Link, useParams } from "react-router";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import PcbBomEditor from "./components/PcbBomEditor";
import PcbBomHistory from "./components/PcbBomHistory";
import { usePcbBomDetail } from "./hooks/usePcbBomDetail";
import { usePcbProduceAccess } from "./hooks/usePcbProduceAccess";
import { isPcbCardId } from "./services/pcbBomService";

export default function PcbDetailPage() {
  const { pcbCardId = "" } = useParams<{ pcbCardId: string }>();
  const { detailQuery, canEdit, save, profileId } = usePcbBomDetail(pcbCardId);
  const canProduce = usePcbProduceAccess();

  if (!isPcbCardId(pcbCardId)) {
    return <ErrorState title="PCB Card not found" message="The PCB Card could not be found." />;
  }
  if (detailQuery.isPending) return <LoadingState message="Loading PCB Card..." />;
  if (detailQuery.isError || !detailQuery.data?.ok) {
    const notFound = detailQuery.data?.ok === false && detailQuery.data.error.code === "not_found";
    return <ErrorState title={notFound ? "PCB Card not found" : "Unable to load PCB Card"}
      message={detailQuery.data?.ok === false ? detailQuery.data.error.message : "PCB Card could not be loaded."}
      onRetry={notFound ? undefined : () => void detailQuery.refetch()} />;
  }
  const detail = detailQuery.data.value;
  return <div className="space-y-6">
    <PageHeader title={detail.name} description="PCB Card definition and current BOM."
      actions={detail.isActive && canProduce ? <Link to={`/pcb/${pcbCardId}/produce`}
        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Produce PCB</Link> : undefined} />
    <Link to="/pcb" className="inline-block text-sm font-semibold text-zinc-700 hover:text-red-700">← Back to PCB Cards</Link>
    <dl className="grid gap-5 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-xs font-semibold uppercase text-zinc-500">Output Serial Number</dt>
        <dd className="mt-2 font-mono text-lg font-semibold">{detail.outputSerialNumber}</dd></div>
      <div><dt className="text-xs font-semibold uppercase text-zinc-500">Finished-good stock</dt>
        <dd className="mt-2 text-lg font-semibold">{detail.outputCurrentStock}</dd></div>
      <div><dt className="text-xs font-semibold uppercase text-zinc-500">Active BOM Version</dt>
        <dd className="mt-2 text-lg font-semibold">{detail.versionNumber ?? "None"}</dd></div>
      <div><dt className="text-xs font-semibold uppercase text-zinc-500">Status</dt><dd className="mt-2">
        <StatusBadge label={detail.isActive ? "Active" : "Archived"} tone={detail.isActive ? "success" : "neutral"} />
      </dd></div>
    </dl>
    <PcbBomEditor detail={detail} canEdit={canEdit} profileId={profileId} onSave={save} />
    <PcbBomHistory cardId={pcbCardId} />
  </div>;
}
