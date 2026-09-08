import StatusBadge from "../../../shared/components/StatusBadge";
import type { Brand } from "../services/brandService";

export interface BrandListProps {
  brands: Brand[];
  canManage: boolean;
  onEdit: (brand: Brand) => void;
  onArchive: (brand: Brand) => void;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function BrandList({
  brands,
  canManage,
  onEdit,
  onArchive,
}: BrandListProps) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-zinc-200 text-left">
        <thead className="bg-zinc-50">
          <tr>
            <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Brand Name
            </th>
            <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Status
            </th>
            <th scope="col" className="whitespace-nowrap px-5 py-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Updated
            </th>
            {canManage && (
              <th scope="col" className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {brands.map((brand) => (
            <tr key={brand.id} className="text-sm text-zinc-700">
              <td className="px-5 py-4 font-semibold text-zinc-900">
                {brand.name}
              </td>
              <td className="px-5 py-4">
                <StatusBadge
                  label={brand.isActive ? "Active" : "Archived"}
                  tone={brand.isActive ? "success" : "neutral"}
                />
              </td>
              <td className="whitespace-nowrap px-5 py-4">
                {formatDate(brand.updatedAt)}
              </td>
              {canManage && (
                <td className="whitespace-nowrap px-5 py-4 text-right">
                  {brand.isActive ? (
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(brand)}
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onArchive(brand)}
                        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
                      >
                        Archive
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm text-zinc-400">No actions</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default BrandList;
