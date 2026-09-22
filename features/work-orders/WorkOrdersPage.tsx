import { useMemo, useState, type ReactNode } from "react";

import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import WorkOrderList from "./components/WorkOrderList";
import { useWorkOrders } from "./hooks/useWorkOrders";
import {
  filterWorkOrders,
  isWorkOrderStatusFilter,
  workOrderStatusOptions,
  type WorkOrderStatusFilter,
} from "./workOrderSearch";

function WorkOrdersPage() {
  const workOrdersQuery = useWorkOrders();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<WorkOrderStatusFilter>("all");
  const workOrders = workOrdersQuery.data?.ok ? workOrdersQuery.data.value : [];
  const filteredWorkOrders = useMemo(
    () => filterWorkOrders(workOrders, search, statusFilter),
    [search, statusFilter, workOrders],
  );

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
  }

  let content: ReactNode;

  if (workOrdersQuery.isPending) {
    content = <LoadingState message="Loading Work Orders..." />;
  } else if (workOrdersQuery.isError || !workOrdersQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to load Work Orders"
        message={
          workOrdersQuery.data?.ok === false
            ? workOrdersQuery.data.error.message
            : "The Work Order list could not be loaded."
        }
        onRetry={() => void workOrdersQuery.refetch()}
      />
    );
  } else if (workOrders.length === 0) {
    content = (
      <EmptyState
        title="No Work Orders yet."
        description="There are no Work Orders to display."
      />
    );
  } else if (filteredWorkOrders.length === 0) {
    content = (
      <EmptyState
        title="No matching Work Orders"
        description="No Work Orders match the current search and status filter."
        action={{ label: "Clear filters", onClick: clearFilters }}
      />
    );
  } else {
    content = <WorkOrderList workOrders={filteredWorkOrders} />;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Work Orders"
        description="View and find Draft and Finished AlfaEV Work Orders."
      />

      {!workOrdersQuery.isPending && workOrdersQuery.data?.ok && workOrders.length > 0 && (
        <div className="grid gap-4 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_14rem]">
          <div>
            <label
              htmlFor="work-order-search"
              className="block text-sm font-semibold text-zinc-800"
            >
              Search Work Orders
            </label>
            <input
              id="work-order-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by Work Order number, Project, or Customer"
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
          </div>
          <div>
            <label
              htmlFor="work-order-status-filter"
              className="block text-sm font-semibold text-zinc-800"
            >
              Filter by status
            </label>
            <select
              id="work-order-status-filter"
              value={statusFilter}
              onChange={(event) => {
                if (isWorkOrderStatusFilter(event.target.value)) {
                  setStatusFilter(event.target.value);
                }
              }}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            >
              {workOrderStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {content}
    </section>
  );
}

export default WorkOrdersPage;
