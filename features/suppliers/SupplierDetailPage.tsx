import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import SupplierFormDialog from "./components/SupplierFormDialog";
import { useSupplierDetail } from "./hooks/useSupplierDetail";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function valueOrUnavailable(value: string | null): string {
  return value ?? "Not provided";
}

function SupplierDetailPage() {
  const { supplierId = "" } = useParams<{ supplierId: string }>();
  const { supplierQuery, canEdit, update } = useSupplierDetail(supplierId);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  let content: ReactNode;

  if (!supplierId) {
    content = (
      <ErrorState
        title="Supplier not found"
        message="The Supplier could not be found."
      />
    );
  } else if (supplierQuery.isPending) {
    content = <LoadingState message="Loading Supplier details..." />;
  } else if (supplierQuery.isError || !supplierQuery.data?.ok) {
    const isNotFound = supplierQuery.data?.ok === false &&
      supplierQuery.data.error.code === "supplier_not_found";
    content = (
      <ErrorState
        title={isNotFound ? "Supplier not found" : "Unable to load Supplier"}
        message={
          supplierQuery.data?.ok === false
            ? supplierQuery.data.error.message
            : "The Supplier details could not be loaded."
        }
        onRetry={isNotFound ? undefined : () => void supplierQuery.refetch()}
      />
    );
  } else {
    const supplier = supplierQuery.data.value;
    content = (
      <>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Supplier
                </p>
                <h2 className="mt-2 text-2xl font-bold text-zinc-900">
                  {supplier.name}
                </h2>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setIsEditOpen(true);
                  }}
                  className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                >
                  Edit Supplier
                </button>
              )}
            </div>

            <dl className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Country</dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">{supplier.country}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Contact Person</dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">{valueOrUnavailable(supplier.contactPersonName)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Email</dt>
                <dd className="mt-2 break-all text-sm font-medium text-zinc-900">{valueOrUnavailable(supplier.contactEmail)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Phone</dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">{valueOrUnavailable(supplier.contactPhone)}</dd>
              </div>
            </dl>
          </section>

          <aside className="h-fit rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-zinc-900">Supplier status</h2>
            <dl className="mt-5 space-y-5">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</dt>
                <dd className="mt-2">
                  <StatusBadge
                    label={supplier.isActive ? "Active" : "Archived"}
                    tone={supplier.isActive ? "success" : "neutral"}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Created</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">{formatDate(supplier.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Last updated</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">{formatDate(supplier.updatedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Archived at</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">
                  {supplier.archivedAt ? formatDate(supplier.archivedAt) : "Not archived"}
                </dd>
              </div>
            </dl>
          </aside>
        </div>

        <SupplierFormDialog
          open={isEditOpen}
          mode="edit"
          initialValues={{
            name: supplier.name,
            country: supplier.country,
            contactPersonName: supplier.contactPersonName,
            contactPhone: supplier.contactPhone,
            contactEmail: supplier.contactEmail,
          }}
          onClose={() => setIsEditOpen(false)}
          onSubmit={update}
          onSucceeded={() => setSuccessMessage("Supplier updated.")}
        />
      </>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Supplier Detail"
        description="View Supplier contact and lifecycle information."
        actions={
          <Link
            to="/suppliers"
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2"
          >
            Back to Suppliers
          </Link>
        }
      />

      {successMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}

      {content}
    </section>
  );
}

export default SupplierDetailPage;
