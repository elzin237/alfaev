import { useEffect, useRef, useState } from "react";
import { Check, Copy, Layers3 } from "lucide-react";
import { Link } from "react-router";

import type { Supplier } from "../services/supplierService";

export interface SupplierListProps {
  suppliers: Supplier[];
  totalSupplierCount: number;
}

function valueOrDash(value: string | null): string {
  return value ?? "—";
}

function supplierInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1
    ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
    : words[0]?.slice(0, 2) ?? "";
  return initials.toUpperCase() || "SU";
}

function isProvenanceSupplier(supplier: Supplier): boolean {
  return supplier.name.toLowerCase().includes("provenance");
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function CatalogNumber({ supplier }: { supplier: Supplier }) {
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  if (!supplier.catalogNumber) return <span className="text-zinc-400">—</span>;

  async function copyCatalogNumber() {
    if (!supplier.catalogNumber || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(supplier.catalogNumber);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard denial leaves the exact Catalog Number visible and unchanged.
    }
  }

  return (
    <div
      title={supplier.catalogNumber}
      className="inline-flex max-w-56 items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-zinc-700"
    >
      <span className="truncate font-mono text-sm font-medium">
        {supplier.catalogNumber}
      </span>
      <button
        type="button"
        onClick={() => void copyCatalogNumber()}
        aria-label={copied
          ? `Catalog Number copied for ${supplier.name}`
          : `Copy Catalog Number ${supplier.catalogNumber}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-500"
      >
        {copied
          ? <Check aria-hidden="true" className="h-4 w-4 text-emerald-600" />
          : <Copy aria-hidden="true" className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SupplierIdentity({ supplier }: { supplier: Supplier }) {
  const provenance = isProvenanceSupplier(supplier);
  const hasContact = Boolean(
    supplier.contactPersonName || supplier.contactEmail || supplier.contactPhone,
  );

  return (
    <div className="flex min-w-64 items-start gap-3">
      <span
        aria-hidden="true"
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          provenance
            ? "bg-zinc-100 text-zinc-600"
            : "bg-red-50 text-red-700"
        }`}
      >
        {provenance
          ? <Layers3 className="h-5 w-5" />
          : supplierInitials(supplier.name)}
      </span>
      <div className="min-w-0">
        <Link
          to={`/suppliers/${supplier.id}`}
          title={supplier.name}
          className="block max-w-64 truncate text-sm font-semibold text-zinc-950 underline-offset-4 transition hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-200"
        >
          {supplier.name}
        </Link>
        {provenance && (
          <p className="mt-0.5 font-mono text-xs text-zinc-500" title={supplier.id}>
            ID {shortId(supplier.id)}
          </p>
        )}
        {hasContact ? (
          <div className="mt-1 space-y-0.5 text-xs leading-5 text-zinc-500">
            {supplier.contactPersonName && <p>{supplier.contactPersonName}</p>}
            {supplier.contactEmail && <p>{supplier.contactEmail}</p>}
            {supplier.contactPhone && <p>{supplier.contactPhone}</p>}
          </div>
        ) : (
          <p className="mt-1 text-xs text-zinc-400">No contact details</p>
        )}
      </div>
    </div>
  );
}

function SupplierList({ suppliers, totalSupplierCount }: SupplierListProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[860px] divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              {[
                "Supplier",
                "Catalog Number",
                "Description",
                "Country",
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
              <tr key={supplier.id} className="align-middle transition hover:bg-zinc-50/70">
                <th scope="row" className="px-5 py-4 text-left font-normal">
                  <SupplierIdentity supplier={supplier} />
                </th>
                <td className="px-5 py-4"><CatalogNumber supplier={supplier} /></td>
                <td className="w-full min-w-56 px-5 py-4 text-sm leading-5 text-zinc-600">
                  <span title={supplier.description ?? undefined} className="line-clamp-2">
                    {valueOrDash(supplier.description)}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm text-zinc-700">{supplier.country}</td>
                <td className="whitespace-nowrap px-5 py-4">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${supplier.isActive ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${supplier.isActive ? "bg-emerald-600" : "bg-zinc-400"}`} />
                    {supplier.isActive ? "Active" : "Archived"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-zinc-200 px-5 py-4 text-sm text-zinc-500">
        Showing <span className="font-semibold text-zinc-800">{suppliers.length}</span> of{" "}
        <span className="font-semibold text-zinc-800">{totalSupplierCount}</span> suppliers
      </div>
    </div>
  );
}

export default SupplierList;
