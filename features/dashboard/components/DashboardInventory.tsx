import { Link } from "react-router";

import type { DashboardInventorySection } from "../services/dashboardService";

export interface DashboardInventoryProps {
  section: DashboardInventorySection | null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function DashboardInventory({ section }: DashboardInventoryProps) {
  if (section === null) return null;

  return (
    <section
      aria-labelledby="dashboard-inventory-title"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="dashboard-inventory-title" className="text-lg font-bold text-zinc-900">
            Inventory
          </h2>
          <dl className="flex items-baseline gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
            <dt className="text-[0.68rem] font-bold uppercase tracking-wide text-zinc-500">
              Active Products
            </dt>
            <dd className="text-lg font-bold tabular-nums text-zinc-950">
              {section.activeProductCount}
            </dd>
          </dl>
        </div>
        <Link
          to="/inventory"
          className="rounded-lg text-sm font-semibold text-red-600 underline-offset-4 transition hover:text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
        >
          View all inventory
        </Link>
      </div>

      <div className="px-5 py-4">
        {section.recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No active products yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {section.recent.map((product) => (
              <li
                key={product.productId}
                className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
              >
                <div className="min-w-0">
                  <Link
                    to={`/inventory/${product.productId}`}
                    className="font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
                  >
                    {product.name}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    <span className="font-mono font-medium text-zinc-700">
                      {product.serialNumber}
                    </span>
                    <span aria-hidden="true"> · </span>
                    {product.category}
                  </p>
                </div>

                <dl className="text-xs sm:text-right">
                  <dt className="text-zinc-500">Quantity</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900">
                    {product.quantity}
                  </dd>
                </dl>

                <p className="text-xs text-zinc-500 sm:text-right">
                  <span className="block font-medium text-zinc-700">Updated</span>
                  <time dateTime={product.updatedAt}>
                    {dateTimeFormatter.format(new Date(product.updatedAt))}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DashboardInventory;
