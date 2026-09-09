import { useMemo, useState, type ReactNode } from "react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import CreateSupplierDialog from "./components/CreateSupplierDialog";
import SupplierList from "./components/SupplierList";
import { useSuppliers } from "./hooks/useSuppliers";
import { filterSuppliers } from "./supplierSearch";

function SuppliersPage() {
  const { suppliersQuery, canCreate, create } = useSuppliers();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const suppliers = suppliersQuery.data?.ok ? suppliersQuery.data.value : [];
  const filteredSuppliers = useMemo(
    () => filterSuppliers(suppliers, search),
    [search, suppliers],
  );

  function openCreateDialog() {
    setSuccessMessage(null);
    setIsCreateOpen(true);
  }

  let content: ReactNode;

  if (suppliersQuery.isPending) {
    content = <LoadingState message="Loading Suppliers..." />;
  } else if (suppliersQuery.isError || !suppliersQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to load Suppliers"
        message={
          suppliersQuery.data?.ok === false
            ? suppliersQuery.data.error.message
            : "The Supplier list could not be loaded."
        }
        onRetry={() => void suppliersQuery.refetch()}
      />
    );
  } else if (suppliers.length === 0) {
    content = (
      <EmptyState
        title="No Suppliers found"
        description="There are no Suppliers to display."
      />
    );
  } else if (filteredSuppliers.length === 0) {
    content = (
      <EmptyState
        title="No matching Suppliers"
        description="No Suppliers match the current search."
        action={{ label: "Clear search", onClick: () => setSearch("") }}
      />
    );
  } else {
    content = <SupplierList suppliers={filteredSuppliers} />;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="View active and archived AlfaEV Suppliers."
        actions={
          canCreate ? (
            <button
              type="button"
              onClick={openCreateDialog}
              className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
            >
              Add Supplier
            </button>
          ) : undefined
        }
      />

      {!suppliersQuery.isPending && suppliersQuery.data?.ok && suppliers.length > 0 && (
        <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <label htmlFor="supplier-search" className="block text-sm font-semibold text-zinc-800">
            Search Suppliers
          </label>
          <input
            id="supplier-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, country, or contact details"
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      )}

      {successMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}

      {content}

      <CreateSupplierDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={create}
        onCreated={() => setSuccessMessage("Supplier added.")}
      />
    </section>
  );
}

export default SuppliersPage;
