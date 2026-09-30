import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { useAuth } from "../../app/auth/AuthProvider";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import { getWorkOrderPdfAccess } from "./services/workOrderPdfAccessService";
import { isWorkOrderId } from "./services/workOrderService";

function WorkOrderPdfViewerPage() {
  const { workOrderId = "" } = useParams<{ workOrderId: string }>();
  const { profile } = useAuth();
  const validWorkOrderId = isWorkOrderId(workOrderId);
  const accessQuery = useQuery({
    queryKey: ["work-orders", "pdf-access", profile?.id, workOrderId],
    queryFn: () => getWorkOrderPdfAccess(workOrderId),
    enabled: Boolean(validWorkOrderId && profile?.id && profile.isActive),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  if (!validWorkOrderId) {
    return (
      <section className="space-y-6">
        <ErrorState
          title="Work Order PDF not found"
          message="The Work Order PDF could not be found."
        />
      </section>
    );
  }

  let content;
  if (accessQuery.isPending || accessQuery.isFetching) {
    content = <LoadingState message="Preparing Work Order PDF..." />;
  } else if (accessQuery.isError || !accessQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to open Work Order PDF"
        message={accessQuery.data?.ok === false
          ? accessQuery.data.error.message
          : "The official Work Order PDF could not be opened. Please try again."}
        onRetry={() => void accessQuery.refetch()}
      />
    );
  } else {
    content = (
      <>
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          Use the browser PDF viewer to print or save a copy. If access expires,
          refresh the PDF to request a new authorized link.
        </div>
        <iframe
          title="Official Work Order PDF"
          src={accessQuery.data.value.signedUrl}
          referrerPolicy="no-referrer"
          className="h-[75vh] min-h-[38rem] w-full rounded-2xl border border-zinc-300 bg-white shadow-sm"
        />
      </>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Official Work Order PDF"
        description="Private, authorized document access"
      />
      {content}
      <div className="flex flex-wrap gap-3">
        {accessQuery.data?.ok && (
          <button
            type="button"
            onClick={() => void accessQuery.refetch()}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
          >
            Refresh PDF access
          </button>
        )}
        <Link
          to={`/work-orders/${workOrderId}`}
          className="inline-flex rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
        >
          Back to Work Order
        </Link>
      </div>
    </section>
  );
}

export default WorkOrderPdfViewerPage;
