import { useState } from "react";
import { useParams } from "react-router";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import PcbProductionPrecheckForm from "./components/PcbProductionPrecheckForm";
import { usePcbProductionPrecheck } from "./hooks/usePcbProductionPrecheck";
import { usePcbProduction } from "./hooks/usePcbProduction";
import { isPcbCardId } from "./services/pcbBomService";

export default function PcbProductionPrecheckPage() {
  const { pcbCardId = "" } = useParams<{ pcbCardId: string }>();
  const [completed, setCompleted] = useState<{ runId: string; cardName: string; quantity: string; projectName: string | null } | null>(null);
  const { sourceQuery, projectsQuery } = usePcbProductionPrecheck(pcbCardId);
  const production = usePcbProduction(pcbCardId);
  if (!isPcbCardId(pcbCardId)) return <ErrorState title="PCB Card not found" message="The PCB Card could not be found." />;
  if (completed) return <div className="space-y-6">
    <PageHeader title="Production completed" description={`PCB Card: ${completed.cardName}`} />
    <section role="status" className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-950 shadow-sm">
      <p className="font-semibold">Production completed.</p>
      <p className="mt-2">Quantity produced: {completed.quantity}</p>
      <p>Destination: {completed.projectName ?? "General Stock"}</p>
      <p className="mt-3 font-mono text-xs">Production reference: {completed.runId}</p>
    </section>
  </div>;
  if (sourceQuery.isPending) return <LoadingState message="Loading production precheck..." />;
  if (sourceQuery.isError || !sourceQuery.data?.ok) {
    const missing = sourceQuery.data?.ok === false && sourceQuery.data.error.code === "not_found";
    return <ErrorState title={missing ? "PCB Card not found" : "Unable to load production precheck"}
      message={sourceQuery.data?.ok === false ? sourceQuery.data.error.message : "Production precheck could not be loaded."}
      onRetry={missing ? undefined : () => void sourceQuery.refetch()} />;
  }
  const source = sourceQuery.data.value;
  return <div className="space-y-6">
    <PageHeader title={`Produce ${source.cardName}`} description={`Output Serial Number: ${source.outputSerialNumber} · Active BOM v${source.versionNumber}`} />
    {projectsQuery.isPending ? <LoadingState message="Loading Project choices..." /> :
      projectsQuery.isError || !projectsQuery.data?.ok ?
        <ErrorState title="Unable to load Project choices" message="Project choices could not be loaded."
          onRetry={() => void projectsQuery.refetch()} /> :
        <PcbProductionPrecheckForm source={source} projects={projectsQuery.data.value}
          isRefreshing={Boolean(sourceQuery.isFetching || projectsQuery.isFetching || production.isSubmitting)}
          submit={production.submit} onProduced={setCompleted} />}
  </div>;
}
