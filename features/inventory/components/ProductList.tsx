import StatusBadge from "../../../shared/components/StatusBadge";
import type { Product } from "../services/productService";

export interface ProductListProps {
  products: Product[];
}

function ProductList({ products }: ProductListProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {["Serial Number", "Name", "Category", "Brand", "Status"].map(
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
            {products.map((product) => (
              <tr key={product.id} className="text-sm text-zinc-700">
                <th scope="row" className="whitespace-nowrap px-5 py-4 text-left font-mono font-semibold text-zinc-900">
                  {product.serialNumber}
                </th>
                <td className="px-5 py-4 font-semibold text-zinc-900">
                  {product.name}
                </td>
                <td className="px-5 py-4">{product.category}</td>
                <td className="px-5 py-4">{product.brandName ?? "—"}</td>
                <td className="whitespace-nowrap px-5 py-4">
                  <StatusBadge
                    label={product.isActive ? "Active" : "Archived"}
                    tone={product.isActive ? "success" : "neutral"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ProductList;
