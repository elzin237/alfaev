import { useEffect, useState, type ReactNode } from "react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import ProcurementList from "./components/ProcurementList";
import {
  useProcurementRequests,
  useProcurementSupplierOptions,
} from "./hooks/useProcurementRequests";
import {
  isProcurementStatusFilter,
  procurementStatusOptions,
  type ProcurementStatusFilter,
} from "./procurementStatus";

function ProcurementPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ProcurementStatusFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const filters = {
    search: debouncedSearch,
    status: statusFilter === "all" ? null : statusFilter,
    supplierId: supplierFilter === "all" ? null : supplierFilter,
  };
  const requestsQuery = useProcurementRequests(filters);
  const supplierOptionsQuery = useProcurementSupplierOptions();
  const requests = requestsQuery.data?.ok ? requestsQuery.data.value : [];
  const supplierOptions = supplierOptionsQuery.data?.ok
    ? supplierOptionsQuery.data.value
    : [];
  const hasFilters = Boolean(
    debouncedSearch || statusFilter !== "all" || supplierFilter !== "all",
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setSupplierFilter("all");
  }

  let content: ReactNode;

  if (requestsQuery.isPending || supplierOptionsQuery.isPending) {
    content = <LoadingState message="Loading Procurement requests..." />;
  } else if (
    requestsQuery.isError ||
    supplierOptionsQuery.isError ||
    !requestsQuery.data?.ok ||
    !supplierOptionsQuery.data?.ok
  ) {
    const message = requestsQuery.data?.ok === false
      ? requestsQuery.data.error.message
      : supplierOptionsQuery.data?.ok === false
      ? supplierOptionsQuery.data.error.message
      : "The Procurement request list could not be loaded.";

    content = (
      <ErrorState
        title="Unable to load Procurement"
        message={message}
        onRetry={() => {
          void requestsQuery.refetch();
          void supplierOptionsQuery.refetch();
        }}
      />
    );
  } else if (requests.length === 0) {
    content = hasFilters || supplierOptions.length > 0 ? (
      <EmptyState
        title="No matching Procurement requests"
        description="No Procurement requests match the current search and filters."
        action={{ label: "Clear filters", onClick: clearFilters }}
      />
    ) : (
      <EmptyState
        title="No Procurement requests found"
        description="There are no Procurement requests to display."
      />
    );
  } else {
    content = <ProcurementList requests={requests} />;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Nabavka"
        description="Track active, partly delivered, and resolved Procurement requests."
      />

      <div className="grid gap-4 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-3">
        <div>
          <label
            htmlFor="procurement-search"
            className="block text-sm font-semibold text-zinc-800"
          >
            Search by Name / Serial Number
          </label>
          <input
            id="procurement-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or Serial Number / Šifra"
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <div>
          <label
            htmlFor="procurement-status-filter"
            className="block text-sm font-semibold text-zinc-800"
          >
            Status
          </label>
          <select
            id="procurement-status-filter"
            value={statusFilter}
            onChange={(event) => {
              if (isProcurementStatusFilter(event.target.value)) {
                setStatusFilter(event.target.value);
              }
            }}
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          >
            {procurementStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="procurement-supplier-filter"
            className="block text-sm font-semibold text-zinc-800"
          >
            Supplier
          </label>
          <select
            id="procurement-supplier-filter"
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="all">All Suppliers</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier.supplierId} value={supplier.supplierId}>
                {supplier.supplierName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {content}
    </section>
  );
}

export default ProcurementPage;
