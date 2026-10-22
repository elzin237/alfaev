import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import type { ProductListItem } from "../services/productService";
import type { InventoryCommitment } from "../services/inventoryCommitmentService";

export interface ProductListProps {
  products: ProductListItem[];
  warehouseCode?: string;
  commitments?: ReadonlyMap<string, InventoryCommitment>;
  showCommitments?: boolean;
}

function ProductList({ products, warehouseCode, commitments, showCommitments = true }: ProductListProps) {
  const headings = ["Serial Number", "Name", "Category", "Brand", "Physical Quantity"];
  if (showCommitments) headings.push("Committed to Projects", "Available after Commitments");
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
                    className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
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
                <td className="whitespace-nowrap px-5 py-4 tabular-nums">{product.quantity}</td>
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
