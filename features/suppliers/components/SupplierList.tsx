import { Link } from "react-router";

import StatusBadge from "../../../shared/components/StatusBadge";
import type { Supplier } from "../services/supplierService";

export interface SupplierListProps {
  suppliers: Supplier[];
}

function valueOrDash(value: string | null): string {
  return value ?? "—";
}

function SupplierList({ suppliers }: SupplierListProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {[
                "Supplier Name",
                "Country",
                "Contact Person",
                "Email",
                "Phone",
                "Status",
              ].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {suppliers.map((supplier) => (
              <tr key={supplier.id} className="align-top">
                <th scope="row" className="whitespace-nowrap px-5 py-4 text-left text-sm font-semibold text-zinc-900">
                  <Link
                    to={`/suppliers/${supplier.id}`}
                    className="text-zinc-900 underline-offset-4 transition hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-200"
                  >
                    {supplier.name}
                  </Link>
                </th>
                <td className="whitespace-nowrap px-5 py-4 text-sm text-zinc-700">{supplier.country}</td>
                <td className="whitespace-nowrap px-5 py-4 text-sm text-zinc-700">{valueOrDash(supplier.contactPersonName)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-sm text-zinc-700">{valueOrDash(supplier.contactEmail)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-sm text-zinc-700">{valueOrDash(supplier.contactPhone)}</td>
                <td className="whitespace-nowrap px-5 py-4">
                  <StatusBadge
                    label={supplier.isActive ? "Active" : "Archived"}
                    tone={supplier.isActive ? "success" : "neutral"}
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

export default SupplierList;
