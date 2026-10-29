import { Link } from "react-router";
import type { ReactNode } from "react";

import StatusBadge from "../../../shared/components/StatusBadge";
import type { ProductListItem } from "../services/productService";
import type { InventoryCommitment } from "../services/inventoryCommitmentService";
import type { InventoryTestCommitment } from "../services/inventoryTestCommitmentService";
import type { InventoryStockHealth } from "../services/inventoryStockHealthService";

export interface ProductListProps {
  products: ProductListItem[];
  warehouseCode?: string;
  commitments?: ReadonlyMap<string, InventoryCommitment>;
  showCommitments?: boolean;
  showTestCommitments?: boolean;
  testCommitments?: ReadonlyMap<string, InventoryTestCommitment>;
  showStockHealth?: boolean;
  stockHealth?: ReadonlyMap<string, InventoryStockHealth>;
  renderMinimum?: (product: ProductListItem, health: InventoryStockHealth | undefined) => ReactNode;
}

function ProductList({ products, warehouseCode, commitments, showCommitments = true, showTestCommitments = false, testCommitments, showStockHealth = false, stockHealth, renderMinimum }: ProductListProps) {
  const rawMaterials = !warehouseCode || warehouseCode === "raw_materials";
  const headings = ["Serial Number", "Name", "Category", "Brand", rawMaterials ? "Raw Physical Quantity" : "Physical Quantity"];
  if (showCommitments) {
    headings.push(...(warehouseCode === "finished_goods"
      ? ["Reserved to Projects", "Available FG"]
      : rawMaterials ? ["Outstanding Project Demand", "Available After Demand (Raw + Customs)"]
        : ["Committed to Projects", "Available After Commitments"]));
  }
  if (showTestCommitments) headings.push("Committed to Tests", "Available After Projects and Tests");
  if (showStockHealth) headings.push("Minimum Stock", "Stock Health");
  headings.push("Status");
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {headings.map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className={`px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide ${heading === "Committed to Tests" ? "text-blue-700" : "text-zinc-500"}`}
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {products.map((product) => {
              const commitment = commitments?.get(product.id);
              const testCommitment = testCommitments?.get(product.id);
              const health = stockHealth?.get(product.id);
              return (
              <tr key={product.id} className="text-sm text-zinc-700">
                <th scope="row" className="whitespace-nowrap px-5 py-4 text-left font-mono font-semibold text-zinc-900">
                  {product.serialNumber}
                </th>
                <td className="px-5 py-4 font-semibold text-zinc-900">
                  <Link
                    to={`/inventory/${product.id}${warehouseCode ? `?warehouse=${warehouseCode}` : ""}`}
                    className="text-zinc-900 underline-offset-4 transition hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-200"
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="px-5 py-4">{product.category}</td>
                <td className="px-5 py-4">{product.brandName ?? "—"}</td>
                <td className="whitespace-nowrap px-5 py-4 tabular-nums">{(warehouseCode === "finished_goods" && commitment ? commitment.physicalQuantity : product.quantity).toString()}</td>
                {showCommitments && <td className="whitespace-nowrap px-5 py-4 tabular-nums">{commitment?.committedToProjects.toString() ?? "Unavailable"}</td>}
                {showCommitments && <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                  {commitment ? (
                    <span className={commitment.availableAfterCommitments < 0n ? "font-semibold text-red-700" : undefined}>
                      {commitment.availableAfterCommitments.toString()}
                      {commitment.availableAfterCommitments < 0n
                        ? ` — Shortage: ${(-commitment.availableAfterCommitments).toString()}`
                        : ""}
                    </span>
                  ) : "Unavailable"}
                </td>}
                {showTestCommitments && <td className="whitespace-nowrap px-5 py-4 font-semibold tabular-nums text-blue-700">{testCommitment?.committedToTests ?? "Unavailable"}</td>}
                {showTestCommitments && <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                  <span className={testCommitment?.availableAfterProjectsAndTests.startsWith("-") ? "font-semibold text-red-700" : undefined}>
                    {testCommitment?.availableAfterProjectsAndTests ?? "Unavailable"}
                  </span>
                </td>}
                {showStockHealth && <td className="px-5 py-4 tabular-nums">
                  {renderMinimum ? renderMinimum(product, health) : health ? health.minimumQuantity ?? "Not Configured" : "Unavailable"}
                </td>}
                {showStockHealth && <td className="whitespace-nowrap px-5 py-4">
                  {health ? <StatusBadge label={{HEALTHY:"Healthy",LOW_STOCK:"Low Stock",OUT_OF_STOCK:"Out of Stock",NOT_CONFIGURED:"Not Configured"}[health.status]}
                    tone={{HEALTHY:"success",LOW_STOCK:"warning",OUT_OF_STOCK:"danger",NOT_CONFIGURED:"neutral"}[health.status] as "success"|"warning"|"danger"|"neutral"} /> : "Unavailable"}
                </td>}
                <td className="whitespace-nowrap px-5 py-4">
                  <StatusBadge
                    label={product.isActive ? "Active" : "Archived"}
                    tone={product.isActive ? "success" : "neutral"}
                  />
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProductList;
