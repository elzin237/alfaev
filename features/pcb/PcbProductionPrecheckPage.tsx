import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import PcbProductionPrecheckForm from "./components/PcbProductionPrecheckForm";
import { usePcbProductionPrecheck } from "./hooks/usePcbProductionPrecheck";
import { usePcbProduction } from "./hooks/usePcbProduction";
import { isPcbCardId } from "./services/pcbBomService";
import { useWorkOrderViewAccess } from "../work-orders/hooks/useWorkOrderViewAccess";

export default function PcbProductionPrecheckPage() {
  const { pcbCardId = "" } = useParams<{ pcbCardId: string }>();
  const navigate = useNavigate();
  const viewAccess = useWorkOrderViewAccess();
  const [completed, setCompleted] = useState<{ workOrderId: string; workOrderNumber: string; cardName: string;
    plannedQuantity: string; projectName: string | null } | null>(null);
  const { sourceQuery } = usePcbProductionPrecheck(pcbCardId);
  const production = usePcbProduction(pcbCardId);
  if (!isPcbCardId(pcbCardId)) return <ErrorState title="Finished-product definition not found" message="The Finished Product Calculator definition could not be found." />;
  if (completed) return <div className="space-y-6">
    <PageHeader title="Production Work Order created" description={`Finished product: ${completed.cardName}`} />
    <section role="status" className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-950 shadow-sm">
      <p className="font-semibold">Draft Work Order {completed.workOrderNumber} was created.</p>
      <p className="mt-2">Planned quantity: {completed.plannedQuantity}</p>
      <p>Destination: {completed.projectName ?? "General Stock"}</p>
      <p className="mt-3">Inventory has not changed. Production is posted only when this Work Order is finished.</p>
    </section>
    {viewAccess.canView && <Link to={`/work-orders/${completed.workOrderId}`}
      className="inline-flex rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white">Open Work Order</Link>}
  </div>;
  if (sourceQuery.isPending) return <LoadingState message="Loading production precheck..." />;
  if (sourceQuery.isError || !sourceQuery.data?.ok) {
    const missing = sourceQuery.data?.ok === false && sourceQuery.data.error.code === "not_found";
    return <ErrorState title={missing ? "Finished-product definition not found" : "Unable to load production precheck"}
      message={sourceQuery.data?.ok === false ? sourceQuery.data.error.message : "Production precheck could not be loaded."}
      onRetry={missing ? undefined : () => void sourceQuery.refetch()} />;
  }
  const source = sourceQuery.data.value;
  return <div className="space-y-6">
    <PageHeader title={`Produce ${source.cardName}`} description={`Output Serial Number: ${source.outputSerialNumber} · Active BOM v${source.versionNumber}`} />
    <PcbProductionPrecheckForm source={source}
      isRefreshing={Boolean(sourceQuery.isFetching || production.isSubmitting)}
      submit={production.submit} onProduced={(summary) => {
        if (viewAccess.canView) navigate(`/work-orders/${summary.workOrderId}`);
        else setCompleted(summary);
      }} />
  </div>;
}
