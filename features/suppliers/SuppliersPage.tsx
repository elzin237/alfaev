import { useMemo, useState, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
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
    content = (
      <SupplierList
        suppliers={filteredSuppliers}
        totalSupplierCount={suppliers.length}
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6 lg:p-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-950 lg:text-4xl">
            Suppliers
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500 sm:text-base">
            Manage supplier master data and default catalog information.
          </p>
        </div>

        {canCreate && (
          <div className="shrink-0">
            <button
              type="button"
              onClick={openCreateDialog}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
              Add Supplier
            </button>
          </div>
        )}
      </header>

      {!suppliersQuery.isPending && suppliersQuery.data?.ok && suppliers.length > 0 && (
        <div className="relative mt-8">
          <label htmlFor="supplier-search" className="sr-only">
            Search Suppliers
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
          />
          <input
            id="supplier-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by supplier name, catalog number, country, or contact details"
            className="w-full rounded-xl border border-zinc-300 bg-white py-3.5 pl-12 pr-4 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
          />
        </div>
      )}

      {successMessage && (
        <p role="status" className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}

      <div className="mt-6">{content}</div>

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
