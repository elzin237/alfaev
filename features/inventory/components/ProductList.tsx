import { Link } from "react-router";
import { useId } from "react";

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
}

function ProductList({ products, warehouseCode, commitments, showCommitments = true, showTestCommitments = false, testCommitments, showStockHealth = false, stockHealth }: ProductListProps) {
  const rawMaterials = !warehouseCode || warehouseCode === "raw_materials";
  const compact = rawMaterials || warehouseCode === "finished_goods";
  const columnHelpId = useId();
  const labels: Record<string, string> = {
    "Serial Number": "Serial", Name: "Product", "Raw Physical Quantity": "Physical", "Physical Quantity": "Physical",
    "Outstanding Project Demand": "Project Demand", "Available After Demand (Raw + Customs)": "Available",
    "Reserved to Projects": "FG Reserved", "Available FG": "Available", "Committed to Tests": "Test Holds",
    "Available After Projects and Tests": "Net Available", "Stock Health": "Health",
  };
  const descriptions: Record<string, string> = {
    "Serial Number": "Product Serial Number.", Name: "Product name. Open Product Detail in this warehouse.",
    Category: "Product category.", Brand: "Product brand.",
    "Raw Physical Quantity": "Raw Physical Quantity: physical stock in Raw Materials only, before commitments.",
    "Physical Quantity": "Physical Quantity: physical stock in Finished Goods, before reservations and Test holds.",
    "Outstanding Project Demand": "Outstanding Project Demand: global Raw + Customs planning demand, not a hard stock reservation.",
    "Available After Demand (Raw + Customs)": "Available After Demand (Raw + Customs): Raw and Customs physical stock minus outstanding Project demand. May be negative; before Test holds.",
    "Reserved to Projects": "Reserved to Projects: active hard Finished Goods Project reservations.",
    "Available FG": "Available FG: Finished Goods physical stock minus hard FG Project reservations, before Test holds.",
    "Committed to Tests": rawMaterials ? "Committed to Tests: active Test holds across Raw Materials and Customs." : "Committed to Tests: active Test holds in Finished Goods only.",
    "Available After Projects and Tests": rawMaterials ? "Available After Projects and Tests: Raw + Customs physical stock minus existing Project planning demand and active Raw/Customs Test holds. May be negative." : "Available After Projects and Tests: Finished Goods physical stock minus hard FG Project reservations and active FG Test holds.",
    "Stock Health": "Stock Health: warehouse physical stock compared with its configured minimum, independent of commitments.",
    Status: "Product Active or Archived status, separate from Stock Health.",
  };
  const cellSpacing = compact ? "px-2 py-3 text-center" : "px-5 py-4";
  const numericClass = `whitespace-nowrap tabular-nums ${cellSpacing} ${compact ? "w-24 min-w-24" : ""}`;
  const headings = ["Serial Number", "Name", "Category", "Brand", rawMaterials ? "Raw Physical Quantity" : "Physical Quantity"];
  if (showCommitments) {
    headings.push(...(warehouseCode === "finished_goods"
      ? ["Reserved to Projects", "Available FG"]
      : rawMaterials ? ["Outstanding Project Demand", "Available After Demand (Raw + Customs)"]
        : ["Committed to Projects", "Available After Commitments"]));
  }
  if (showTestCommitments) headings.push("Committed to Tests", "Available After Projects and Tests");
  if (showStockHealth) headings.push("Stock Health");
  headings.push("Status");
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {headings.map(
                (heading, index) => (
                  <th
                    key={heading}
                    scope="col"
                    aria-label={compact ? labels[heading] ?? heading : undefined}
                    aria-describedby={compact ? `${columnHelpId}-${index}` : undefined}
                    className={`${compact ? "px-2 py-3 text-center whitespace-nowrap" : "px-5 py-4 text-left"} text-xs font-semibold uppercase tracking-wide ${heading === "Committed to Tests" ? "text-blue-700" : "text-zinc-500"}`}
                  >
                    {compact ? <span tabIndex={0} title={descriptions[heading]} aria-describedby={`${columnHelpId}-${index}`} className="group relative inline-block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500">
                      {labels[heading] ?? heading}
                      <span role="tooltip" id={`${columnHelpId}-${index}`} className={`pointer-events-none absolute top-full z-20 mt-2 hidden w-56 rounded-lg bg-zinc-900 px-3 py-2 text-left text-xs font-normal normal-case leading-5 whitespace-normal tracking-normal text-white shadow-lg group-hover:block group-focus:block ${index < 2 ? "left-0" : "right-0"}`}>{descriptions[heading]}</span>
                    </span> : heading}
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
                <th scope="row" className={`whitespace-nowrap ${cellSpacing} ${compact ? "w-24 min-w-24" : "text-left"} font-mono font-semibold text-zinc-900`}>
                  {product.serialNumber}
                </th>
                <td className={`${cellSpacing} ${compact ? "min-w-48" : ""} font-semibold text-zinc-900`}>
                  <Link
                    to={`/inventory/${product.id}${warehouseCode ? `?warehouse=${warehouseCode}` : ""}`}
                    className={`${compact ? "inline-block max-w-56 text-center [overflow-wrap:anywhere]" : ""} text-zinc-900 underline-offset-4 transition hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-200`}
                  >
                    {product.name}
                  </Link>
                </td>
                <td className={cellSpacing}>{product.category}</td>
                <td className={cellSpacing}>{product.brandName ?? "—"}</td>
                <td className={numericClass}>{(warehouseCode === "finished_goods" && commitment ? commitment.physicalQuantity : product.quantity).toString()}</td>
                {showCommitments && <td className={numericClass}>{commitment?.committedToProjects.toString() ?? "Unavailable"}</td>}
                {showCommitments && <td className={numericClass}>
                  {commitment ? (
                    <span className={commitment.availableAfterCommitments < 0n ? "font-semibold text-red-700" : undefined}>
                      {commitment.availableAfterCommitments.toString()}
                      {commitment.availableAfterCommitments < 0n
                        ? ` — Shortage: ${(-commitment.availableAfterCommitments).toString()}`
                        : ""}
                    </span>
                  ) : "Unavailable"}
                </td>}
                {showTestCommitments && <td className={`${numericClass} font-semibold text-blue-700`}>{testCommitment?.committedToTests ?? "Unavailable"}</td>}
                {showTestCommitments && <td className={numericClass}>
                  <span className={testCommitment?.availableAfterProjectsAndTests.startsWith("-") ? "font-semibold text-red-700" : undefined}>
                    {testCommitment?.availableAfterProjectsAndTests ?? "Unavailable"}
                  </span>
                </td>}
                {showStockHealth && <td className={`whitespace-nowrap ${cellSpacing}`}>
                  {health ? <StatusBadge label={{HEALTHY:"Healthy",LOW_STOCK:"Low Stock",OUT_OF_STOCK:"Out of Stock",NOT_CONFIGURED:"Not Configured"}[health.status]}
                    tone={{HEALTHY:"success",LOW_STOCK:"warning",OUT_OF_STOCK:"danger",NOT_CONFIGURED:"neutral"}[health.status] as "success"|"warning"|"danger"|"neutral"} /> : "Unavailable"}
                </td>}
                <td className={`whitespace-nowrap ${cellSpacing}`}>
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
