import { useParams } from "react-router";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import PcbProductionPrecheckForm from "./components/PcbProductionPrecheckForm";
import { usePcbProductionPrecheck } from "./hooks/usePcbProductionPrecheck";
import { isPcbCardId } from "./services/pcbBomService";

export default function PcbProductionPrecheckPage() {
  const { pcbCardId = "" } = useParams<{ pcbCardId: string }>();
  const { sourceQuery, projectsQuery } = usePcbProductionPrecheck(pcbCardId);
  if (!isPcbCardId(pcbCardId)) return <ErrorState title="PCB Card not found" message="The PCB Card could not be found." />;
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
        <PcbProductionPrecheckForm source={source} projects={projectsQuery.data.value} />}
  </div>;
}
