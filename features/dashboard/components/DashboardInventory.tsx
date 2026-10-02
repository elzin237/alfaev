import { Package } from "lucide-react";
import { Link } from "react-router";

import type { DashboardInventorySection } from "../services/dashboardService";
import DashboardSectionHeader from "./DashboardSectionHeader";

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
      className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_12px_30px_rgba(24,24,27,0.04)]"
    >
      <DashboardSectionHeader
        actionLabel="View all inventory"
        actionTo="/inventory"
        icon={Package}
        title="Inventory"
        titleId="dashboard-inventory-title"
      />

      <div className="border-b border-zinc-100 bg-zinc-50/60 px-5 py-3">
        <dl className="inline-flex items-baseline gap-2.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 shadow-sm">
          <dt className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-zinc-500">
            Active Products
          </dt>
          <dd className="text-lg font-bold leading-none tabular-nums text-zinc-950">
            {section.activeProductCount}
          </dd>
        </dl>
      </div>

      <div className="px-5 py-4">
        {section.recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No active products yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {section.recent.map((product) => (
              <li
                key={product.productId}
                className="grid gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
              >
                <div className="min-w-0">
                  <Link
                    to={`/inventory/${product.productId}`}
                    className="rounded-sm font-semibold text-zinc-900 underline-offset-4 transition hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
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
